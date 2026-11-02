"""Add Godot v2 plugin metadata and DEX to a trusted exported APK. Re-sign afterwards."""
from pathlib import Path
import struct as S,sys,zipfile
u16=lambda b,o:S.unpack_from('<H',b,o)[0]
u32=lambda b,o:S.unpack_from('<I',b,o)[0]

def patch(xml):
    assert u16(xml,0)==3
    chunks=[];o=u16(xml,2)
    while o<len(xml):
        size=u32(xml,o+4);assert size>=8
        chunks.append(xml[o:o+size]);o+=size
    pool=next(c for c in chunks if u16(c,0)==1)
    assert u32(pool,12)==0, 'Styled XML pool unsupported'
    count=u32(pool,8);flags=u32(pool,16);start=u32(pool,20);header=u16(pool,2)
    def readlen(b,o,utf8):
        value=b[o] if utf8 else u16(b,o);step=1 if utf8 else 2;bit=0x80 if utf8 else 0x8000
        return (((value&~bit)<<(7 if utf8 else 16))+(b[o+step] if utf8 else u16(b,o+step)),o+2*step) if value&bit else (value,o+step)
    strings=[]
    for i in range(count):
        pos=start+u32(pool,header+i*4)
        if flags&0x100:
            _,pos=readlen(pool,pos,True);n,pos=readlen(pool,pos,True);strings.append(pool[pos:pos+n].decode('utf8'))
        else:
            n,pos=readlen(pool,pos,False);strings.append(pool[pos:pos+n*2].decode('utf-16le'))
    resource=next(c for c in chunks if u16(c,0)==0x180)
    ids=[u32(resource,o) for o in range(8,len(resource),4)]
    def idx(value):
        if value not in strings:strings.append(value)
        return strings.index(value)
    def attridx(name,rid):
        for i,s in enumerate(strings):
            if s==name and i<len(ids) and ids[i]==rid:return i
        strings.append(name);i=len(strings)-1
        while len(ids)<=i:ids.append(0)
        ids[i]=rid;return i
    ns=idx('http://schemas.android.com/apk/res/android');tag=idx('meta-data')
    name=attridx('name',0x01010003);value=attridx('value',0x01010024)
    plugin=idx('org.godotengine.plugin.v2.UfaCredentials');clazz=idx('org.ufagame.security.CredentialsPlugin')
    def attr(n,v):return S.pack('<IIIHBBI',ns,n,v,8,0,3,v)
    begin=S.pack('<HHIII',0x102,16,76,1,0xffffffff)+S.pack('<IIHHHHHH',0xffffffff,tag,20,20,2,0,0,0)+attr(name,plugin)+attr(value,clazz)
    end=S.pack('<HHIIIII',0x103,16,24,1,0xffffffff,0xffffffff,tag)
    def length(n):
        assert n<0x8000
        return bytes([(n>>8)|0x80,n&255]) if n>=0x80 else bytes([n])
    data=bytearray();offsets=[]
    for s in strings:
        offsets.append(len(data));b=s.encode();data+=length(len(s.encode('utf-16le'))//2)+length(len(b))+b+b'\0'
    data+=b'\0'*((-len(data))%4)
    newpool=S.pack('<HHIIIIII',1,28,28+4*len(strings)+len(data),len(strings),0,0x100,28+4*len(strings),0)+S.pack('<'+'I'*len(offsets),*offsets)+data
    newresource=S.pack('<HHI',0x180,8,8+4*len(ids))+S.pack('<'+'I'*len(ids),*ids)
    out=[];inserted=False
    for c in chunks:
        kind=u16(c,0)
        if kind==1:out.append(newpool)
        elif kind==0x180:out.append(newresource)
        else:
            out.append(c)
            if kind==0x102 and strings[u32(c,20)]=='application':
                assert not inserted;out.extend([begin,end]);inserted=True
    assert inserted
    body=b''.join(out);return S.pack('<HHI',3,8,len(body)+8)+body

if __name__=='__main__':
    source,dex,target=map(Path,sys.argv[1:])
    with zipfile.ZipFile(source) as z,zipfile.ZipFile(target,'w') as out:
        assert 'classes2.dex' not in z.namelist()
        for item in z.infolist():
            if item.filename.startswith('META-INF/'):continue
            data=z.read(item.filename)
            if item.filename=='AndroidManifest.xml':data=patch(data)
            out.writestr(item,data)
        out.write(dex,'classes2.dex')
