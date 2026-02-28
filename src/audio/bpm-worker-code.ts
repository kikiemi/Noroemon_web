export const BPM_WORKER_CODE=`
'use strict';
function fft(re,im,N,inv){let b=Math.log2(N)|0,j=0;for(let i=0;i<N;i++){if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}let m=N>>1;while(m>=1&&j>=m){j-=m;m>>=1}j+=m}for(let s=1;s<=b;s++){let m=1<<s,h=m>>1,wr=1,wi=0,a=Math.PI/h*(inv?1:-1),cs=Math.cos(a),sn=Math.sin(a);for(let j0=0;j0<h;j0++){for(let k=j0;k<N;k+=m){let t=k+h,tr=wr*re[t]-wi*im[t],ti=wr*im[t]+wi*re[t];re[t]=re[k]-tr;im[t]=im[k]-ti;re[k]+=tr;im[k]+=ti}let nw=wr*cs-wi*sn;wi=wr*sn+wi*cs;wr=nw}}if(inv)for(let i=0;i<N;i++){re[i]/=N;im[i]/=N}}
self.onmessage=function(e){let d=e.data,sr=d.sampleRate,ch=d.channel,len=ch.length,fs=2048,hp=512;
let nf=Math.floor((len-fs)/hp);if(nf<2){self.postMessage({type:'bpm',value:0});return}
let re=new Float32Array(fs),im=new Float32Array(fs),prev=new Float32Array(fs/2+1),flux=new Float32Array(nf);
let wn=new Float32Array(fs);for(let i=0;i<fs;i++)wn[i]=.5*(1-Math.cos(2*Math.PI*i/(fs-1)));
for(let f=0;f<nf;f++){let off=f*hp;for(let i=0;i<fs;i++){re[i]=ch[off+i]*wn[i];im[i]=0}fft(re,im,fs,false);
let sf=0;for(let i=0;i<=fs/2;i++){let mg=Math.sqrt(re[i]*re[i]+im[i]*im[i]),df=mg-prev[i];if(df>0)sf+=df;prev[i]=mg}flux[f]=sf}
let minBpm=60,maxBpm=200,minLag=Math.floor(60*sr/(hp*maxBpm)),maxLag=Math.ceil(60*sr/(hp*minBpm));
let best=0,bestLag=minLag;
for(let lag=minLag;lag<=maxLag&&lag<nf;lag++){let sum=0;for(let i=0;i<nf-lag;i++)sum+=flux[i]*flux[i+lag];if(sum>best){best=sum;bestLag=lag}}
self.postMessage({type:'bpm',value:Math.round(60*sr/(bestLag*hp)*10)/10})};
`;
