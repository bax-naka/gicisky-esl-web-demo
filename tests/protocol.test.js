import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, HEIGHT, IMAGE_BYTES, CHUNK_SIZE, encode296x128RGBA, announceSize, dataPacket, toHex, transferImage, u32le } from '../protocol.js';

function solid(r,g,b) {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  for(let i=0;i<rgba.length;i+=4){rgba[i]=r;rgba[i+1]=g;rgba[i+2]=b;rgba[i+3]=255;}
  return rgba;
}
test('2.9-inch 4-color pixel encoding: palette and data size', () => {
  const cases = [[0,0,0,0x00],[255,255,255,0x55],[255,255,0,0xaa],[255,0,0,0xff]];
  for(const [r,g,b,expected] of cases){
    const out=encode296x128RGBA(solid(r,g,b));
    assert.equal(out.length, IMAGE_BYTES);
    assert.equal(out[0],expected);
    assert.equal(out[out.length-1],expected);
  }
});
test('image is rotated 90 degrees CCW before packing', () => {
  const src=solid(255,255,255);
  // original top right pixel maps to the very first pixel after CCW rotation
  const i=(WIDTH-1)*4;
  src[i]=0;src[i+1]=0;src[i+2]=0;
  const out=encode296x128RGBA(src);
  assert.equal(out[0],0x15); // first black 00, then 3 white 01
  assert.equal(out[1],0x55);
});
test('packet framing', () => {
  assert.equal(toHex(announceSize(IMAGE_BYTES)),'0200250000000000');
  assert.equal(u32le(Uint8Array.of(0xff,0xff,0xff,0xff)),0xffffffff);
  const bytes=new Uint8Array(IMAGE_BYTES).map((_,i)=>i%256);
  const first=dataPacket(bytes,0);
  assert.equal(first.length,CHUNK_SIZE+4);
  assert.equal(u32le(first),0);
  assert.deepEqual(Array.from(first.subarray(4,8)),[0,1,2,3]);
  const last=dataPacket(bytes,39);
  assert.equal(last.length,4+(IMAGE_BYTES-39*CHUNK_SIZE));
  assert.equal(u32le(last),39);
});
test('transfer handshake + 40 acknowledged chunks + terminal ACK',async () => {
  let calls=0;let blocks=[];
  const link={
    async writeControl(buf){ calls++;return [Uint8Array.of(1,0xf4,0),Uint8Array.of(2),Uint8Array.of(5,0,0,0,0,0)][calls-1]; },
    async writeData(buf){let p=u32le(buf);blocks.push(p);return p===39?Uint8Array.of(5,8,0,0,0,0):Uint8Array.of(5,0,p+1,0,0,0);}
  };
  let progress=0;
  const result=await transferImage(link,new Uint8Array(IMAGE_BYTES),p=>progress=p);
  assert.equal(result.writes,40);
  assert.equal(progress,1);
  assert.deepEqual(blocks,Array.from({length:40},(_,i)=>i));
  assert.equal(calls,3);
});
test('reject bad ACK',async()=> {
  const link={writeControl:async()=>Uint8Array.of(0),writeData:async()=>{throw new Error('should not happen');}};
  await assert.rejects(()=>transferImage(link,new Uint8Array(IMAGE_BYTES)),/START ACK/);
});
