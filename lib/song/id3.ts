// https://p1.music.126.net/05CrrjiAJX8TrPKIuN3Vyg==/109951163556308776.jpg
import NodeID3 from 'node-id3';
const MP3Tag = require('mp3tag.js')
import http from 'http';
import https from 'https';
import fs from 'fs';

// TODO: 支持ID3 tags的写入
function writeID3Tags() {
  // try {
  //   console.log("do my things");
  //   const filepath =
  //   '/Users/tianchen/Music/网易云音乐测试/Manami/ベストフレンド/ベストフレンド ~琉球ver.~.mp3';
  //   let imageBuffer = Buffer.from([]);
  //   https.get('https://p1.music.126.net/05CrrjiAJX8TrPKIuN3Vyg==/109951163556308776.jpg', (dlResp) => {
  //     let chunks = [] as Uint8Array[];
  //     dlResp.on('data', (chunk) => {
  //       chunks.push(chunk);
  //     });
  //     dlResp.on('end', async () => {
  //       imageBuffer = Buffer.concat(chunks);
  //     })
  //   });
  //   const tags = {
  //     title: "爱一个人好难111",
  //     artist: "张亚飞111",
  //     album: "她的时光111",
  //     TRCK: "1",
  //     image: {
  //       mime: 'image/jpeg',
  //       type: {
  //         id: 1,
  //         name: '109951163556308776.jpg'
  //       },
  //       description: '',
  //       imageBuffer
  //     }
  //   } as NodeID3.Tags;
  //   return NodeID3.update(tags, filepath, {}, (err) => {
  //     console.error(err);
  //   });
  //   // const buffer = fs.readFileSync(filepath);
  //   // const mp3tag = new MP3Tag(buffer, true);
  //   // mp3tag.tags.v2.TPE1 = "张亚飞111";
  //   // mp3tag.tags.v2.TIT2 = "爱一个人好难111";
  //   // mp3tag.tags.v2.TALB = "她的时光111";
  //   // mp3tag.save();
  // } catch (e) {
  //   console.error(e);
  // }
}

export {
  writeID3Tags
}

