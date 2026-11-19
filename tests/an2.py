import numpy as np, scipy.signal as ss, scipy.io.wavfile as wf, json, glob, subprocess, sys, re
tag=sys.argv[1]; r={}
def load(f): sr,x=wf.read(f); return sr, x.astype(np.float64)/32768.0
def ebu(f):
    o=subprocess.run(['ffmpeg','-nostats','-i',f,'-af','ebur128=peak=true','-f','null','-'],capture_output=True,text=True).stderr
    I=float(re.findall(r'I:\s+(-?[\d.]+) LUFS',o)[-1]); tp=float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS',o)[-1]); return I,tp
lu={}
for f in sorted(glob.glob(f'/tmp/djtest/rec_{tag}_lufs_*.wav')):
    k=f.split('lufs_')[1][:-4]; lu[k]=ebu(f)[0]
for mode in ['norm','raw']:
    v={k.split('_',1)[1]:x for k,x in lu.items() if k.startswith(mode)}
    if v: r['lufs_'+mode]=v; r['lufs_'+mode+'_spread_dB']=round(max(v.values())-min(v.values()),1)
for n in ['peak_stress','mic_only']:
    f=f'/tmp/djtest/rec_{tag}_{n}.wav'
    try:
        sr,x=load(f); I,tp=ebu(f); r[n]={'sample_peak_dBFS':round(20*np.log10(np.abs(x).max()),2),'true_peak_dBTP':tp,'LUFS':I}
    except Exception as e: r[n]=str(e)
for f in sorted(glob.glob(f'/tmp/djtest/rec_{tag}_clicks_*.wav')):
    sr,x=load(f); m=x.mean(axis=1) if x.ndim>1 else x
    y=np.abs(ss.sosfilt(ss.butter(4,3000,'hp',fs=sr,output='sos'),m))[sr//5:]
    # eventos (picos separados > 30 ms) por encima de -40 dBFS
    idx=np.where(y>10**(-40/20))[0]; ev=0 if len(idx)==0 else 1+int((np.diff(idx)>sr*0.03).sum())
    r[f.split('_clicks_')[1][:-4]+'_clicks']={'hf_peak_dBFS':round(20*np.log10(y.max()+1e-12),1),'events_over_-40dBFS':ev}
for kl in ['on','off']:
    f=f'/tmp/djtest/rec_{tag}_keylock_{kl}.wav'
    try:
        sr,x=load(f); m=x.mean(axis=1)[sr//2:]; X=np.abs(np.fft.rfft(m*np.hanning(len(m)))); k=np.argmax(X); a,b,c=np.log(X[k-1:k+2]); d=0.5*(a-c)/(a-2*b+c); f0=(k+d)*sr/len(m)
        fr=np.fft.rfftfreq(len(m),1/sr); band=(fr>f0-25)&(fr<f0+25); r['keylock_'+kl]={'freq_Hz':round(f0,1),'THD+N_dB':round(10*np.log10((X[~band]**2).sum()/(X[band]**2).sum()),1)}
    except Exception as e: pass
print(json.dumps(r,indent=1,ensure_ascii=False))
