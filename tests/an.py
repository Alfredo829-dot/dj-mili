import numpy as np, scipy.signal as ss, json, sys
SR=48000; r={}
def ld(n): return np.fromfile('/tmp/djtest/out/'+n+'.f32',dtype=np.float32)
def freq(x):
    x=x[SR//2:]; w=np.hanning(len(x)); X=np.abs(np.fft.rfft(x*w)); f=np.fft.rfftfreq(len(x),1/SR); k=np.argmax(X)
    # interpolación parabólica
    a,b,c=np.log(X[k-1:k+2]+1e-20); d=0.5*(a-c)/(a-2*b+c); f0=(k+d)*SR/len(x)
    band=(f>f0-25)&(f<f0+25); thdn=10*np.log10((X[~band]**2).sum()/(X[band]**2).sum())
    return round(f0,1), round(thdn,1)
for n in ['kl_on','kl_off']: r[n+'_freq_hz'], r[n+'_thdn_db']=freq(ld(n))
sos=ss.butter(4,3000,'hp',fs=SR,output='sos')
for n in ['clicks_naive','clicks_rs','clicks_ws']:
    x=ld(n); y=ss.sosfilt(sos,x)[SR//10:]; r[n+'_hf_peak_dbfs']=round(20*np.log10(np.abs(y).max()+1e-12),1)
print(json.dumps(r,indent=1))
