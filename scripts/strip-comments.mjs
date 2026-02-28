import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

function stripTSComments(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        // String literals - skip
        if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
            const q = src[i];
            out += src[i++];
            while (i < src.length) {
                if (src[i] === '\\') { out += src[i++]; out += src[i++]; continue; }
                if (src[i] === q) { out += src[i++]; break; }
                out += src[i++];
            }
            continue;
        }
        // Block comment
        if (src[i] === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        // Line comment
        if (src[i] === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
        }
        out += src[i++];
    }
    // Collapse 3+ consecutive blank lines to 2
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function walk(dir) {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (extname(p) === '.ts') {
            const orig = readFileSync(p, 'utf8');
            const stripped = stripTSComments(orig);
            if (stripped !== orig) { writeFileSync(p, stripped, 'utf8'); console.log('stripped:', p); }
        }
    }
}

walk('src');
console.log('done');
