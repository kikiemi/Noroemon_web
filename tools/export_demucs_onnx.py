import argparse
import json
import math
import os
import sys

import numpy as np
import torch
from demucs.pretrained import get_model
from demucs.apply import BagOfModels


class Core(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, mix, mag):
        m = self.m
        hold = {}

        def spec(x):
            return None

        def magnitude(z):
            return mag

        def mask(z, x):
            hold['spec'] = x
            return x

        def ispec(z, length=None, scale=0):
            b, s = z.shape[0], z.shape[1]
            return torch.zeros(b, s, 2, length, dtype=mix.dtype)

        m._spec = spec
        m._magnitude = magnitude
        m._mask = mask
        m._ispec = ispec
        wave = m.forward(mix)
        return hold['spec'], wave


def np_spec(x, nfft, hl):
    le = int(math.ceil(x.shape[-1] / hl))
    pad = hl // 2 * 3
    x = np.pad(x, ((0, 0), (pad, pad + le * hl - x.shape[-1])), mode='reflect')
    t = torch.from_numpy(x.astype(np.float32))
    z = torch.stft(t, nfft, hl, window=torch.hann_window(nfft), win_length=nfft,
                   normalized=True, center=True, return_complex=True, pad_mode='reflect')
    z = z[:, :-1, 2:2 + le]
    m = torch.view_as_real(z).permute(0, 3, 1, 2).reshape(1, 4, z.shape[1], le)
    return m.numpy()


def np_ispec(spec, length, nfft, hl):
    s = spec.shape[1]
    out = np.zeros((s, 2, length), dtype=np.float32)
    pad = hl // 2 * 3
    le = hl * int(math.ceil(length / hl)) + 2 * pad
    for i in range(s):
        z = torch.from_numpy(spec[0, i]).view(2, 2, spec.shape[3], spec.shape[4])
        z = torch.view_as_complex(z.permute(0, 2, 3, 1).contiguous())
        z = torch.nn.functional.pad(z, (0, 0, 0, 1))
        z = torch.nn.functional.pad(z, (2, 2))
        x = torch.istft(z, nfft, hl, window=torch.hann_window(nfft), win_length=nfft,
                        normalized=True, length=le, center=True)
        out[i] = x[:, pad:pad + length].numpy()
    return out


def split_file(path, part_mb):
    size = os.path.getsize(path)
    step = part_mb * 1024 * 1024
    parts = []
    with open(path, 'rb') as f:
        i = 0
        while True:
            b = f.read(step)
            if not b:
                break
            name = os.path.basename(path) + '.%03d' % i
            with open(os.path.join(os.path.dirname(path), name), 'wb') as g:
                g.write(b)
            parts.append(name)
            i += 1
    os.remove(path)
    return parts, size


def split_manifest(json_path, part_mb):
    with open(json_path, encoding='utf-8') as f:
        info = json.load(f)
    base = os.path.dirname(json_path)
    for m in info['models']:
        full = os.path.join(base, m['file'])
        if os.path.exists(full):
            m['parts'], m['bytes'] = split_file(full, part_mb)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    print(json.dumps(info))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', default='htdemucs_6s')
    ap.add_argument('--out', default='models')
    ap.add_argument('--opset', type=int, default=17)
    ap.add_argument('--part-mb', type=int, default=40)
    ap.add_argument('--split-only', default='')
    a = ap.parse_args()
    if a.split_only:
        split_manifest(a.split_only, a.part_mb)
        return

    torch.backends.mha.set_fastpath_enabled(False)
    bag = get_model(a.name)
    models = bag.models if isinstance(bag, BagOfModels) else [bag]
    os.makedirs(a.out, exist_ok=True)
    entries = []
    for idx, model in enumerate(models):
        model.eval()
        model.use_train_segment = True
        sr = model.samplerate
        length = int(model.segment * sr)
        nfft = model.nfft
        hl = model.hop_length
        le = int(math.ceil(length / hl))
        core = Core(model).eval()
        mix = torch.randn(1, 2, length) * 0.1
        mag = torch.from_numpy(np_spec(mix[0].numpy(), nfft, hl))
        fname = a.name + ('' if len(models) == 1 else '_' + str(idx)) + '.onnx'
        path = os.path.join(a.out, fname)
        with torch.no_grad():
            torch.onnx.export(core, (mix, mag), path, opset_version=a.opset,
                              input_names=['mix', 'spec'], output_names=['out_spec', 'out_wave'],
                              do_constant_folding=True, dynamo=False)

        import onnxruntime as ort
        sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        t = np.arange(length, dtype=np.float32) / sr
        sig = np.stack([np.sin(2 * np.pi * 220 * t) * 0.3 + np.random.randn(length).astype(np.float32) * 0.02,
                        np.sin(2 * np.pi * 330 * t) * 0.3]).astype(np.float32)
        spec_in = np_spec(sig, nfft, hl)
        o_spec, o_wave = sess.run(None, {'mix': sig[None], 'spec': spec_in})
        est = np_ispec(o_spec, length, nfft, hl) + o_wave[0]
        with torch.no_grad():
            model2 = get_model(a.name)
            ref_m = model2.models[idx] if isinstance(model2, BagOfModels) else model2
            ref_m.eval()
            ref = ref_m(torch.from_numpy(sig[None]))[0].numpy()
        err = float(np.max(np.abs(est - ref)))
        print(fname, 'sources', model.sources, 'maxerr', err, 'size', os.path.getsize(path))
        w = None
        if isinstance(bag, BagOfModels):
            w = [float(v) for v in bag.weights[idx]]
        entries.append({'file': fname, 'weights': w})

    info = {
        'name': a.name,
        'kind': 'htdemucs',
        'samplerate': models[0].samplerate,
        'segment': int(models[0].segment * models[0].samplerate),
        'nfft': models[0].nfft,
        'hop': models[0].hop_length,
        'sources': list(models[0].sources),
        'models': entries,
    }
    json_path = os.path.join(a.out, a.name + '.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    if a.part_mb > 0:
        split_manifest(json_path, a.part_mb)
    else:
        print(json.dumps(info))


if __name__ == '__main__':
    sys.exit(main())
