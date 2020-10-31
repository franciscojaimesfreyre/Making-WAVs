const A = require('arcsecond');
const B = require('arcsecond-binary');
const C = require('construct-js');
const fs = require('fs');
const path = require('path');
const d3nLine = require('d3node-linechart');
const output = require('d3node-output');

const file = fs.readFileSync(path.join(__dirname, './file_example.wav'));

const riffChunkSize = B.u32LE.chain(size => {
  if (size !== file.length - 8) {
    return A.fail(`Invalid file size: ${file.length}. Expected ${size + 8}`);
  }
  return A.succeedWith(size);
});

const riffChunk = A.sequenceOf([
  A.str('RIFF'),
  riffChunkSize,
  A.str('WAVE')
]);

const fmtSubChunk = A.coroutine(function* () {
  const id = yield A.str('fmt ');
  const subChunk1Size = yield B.u32LE;
  const audioFormat = yield B.u16LE;
  const numChannels = yield B.u16LE;
  const sampleRate = yield B.u32LE;
  const byteRate = yield B.u32LE;
  const blockAlign = yield B.u16LE;
  const bitsPerSample = yield B.u16LE;

  const expectedByteRate = sampleRate * numChannels * bitsPerSample / 8;
  if (byteRate !== expectedByteRate) {
    yield A.fail(`Invalid byte rate: ${byteRate}, expected ${expectedByteRate}`);
  }

  const expectedBlockAlign = numChannels * bitsPerSample / 8;
  if (blockAlign !== expectedBlockAlign) {
    yield A.fail(`Invalid block align: ${blockAlign}, expected ${expectedBlockAlign}`);
  }

  const fmtChunkData = {
    id,
    subChunk1Size,
    audioFormat,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample
  };

  yield A.setData(fmtChunkData);
  return fmtChunkData;
});

// const factSubChunk = A.coroutine(function* () {
//   const empty1 = yield A.anyChar;
//   const empty2 = yield A.anyChar;
//   const id = yield A.str('fact');
//   const subChunkSize = yield B.u32LE;
//   const audioFormat = yield B.u32LE;

//   const factChunkData = {
//     id,
//     subChunkSize,
//     audioFormat
//   };
//   return factChunkData;
// });



const dataSubChunk = A.coroutine(function* () {
  const id = yield A.str('data');
  const size = yield B.u32LE;

  const fmtData = yield A.getData;

  const samples = size / fmtData.numChannels / (fmtData.bitsPerSample / 8);
  const channelData = Array.from({length: fmtData.numChannels}, () => []);

  let sampleParser;
  if (fmtData.bitsPerSample === 8) {
    sampleParser = B.s8;
  } else if (fmtData.bitsPerSample === 16) {
    sampleParser = B.s16LE;
  } else if (fmtData.bitsPerSample === 32) {
    sampleParser = B.s32LE;
  } else {
    yield A.fail(`Unsupported bits per sample: ${fmtData.bitsPerSample}`);
  }

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    for (let i = 0; i < fmtData.numChannels; i++) {
      const sampleValue = yield sampleParser;
      channelData[i].push(sampleValue);
    }
  }

  return {
    id,
    size,
    channelData
  };
});

const parser = A.sequenceOf([
  riffChunk,
  fmtSubChunk,
  dataSubChunk,
  //A.endOfInput
]).map(([riffChunk, fmtSubChunk,dataSubChunk]) => ({
  riffChunk,
  fmtSubChunk,
  dataSubChunk
}));

const myOutput = parser.run(file.buffer);
if (myOutput.isError) {
  console.log(myOutput.error);
  throw new Error(myOutput.error);
}
console.log(myOutput.result.dataSubChunk.channelData);


const dataArray = peakNormalize(myOutput.result.dataSubChunk.channelData[0],32768);
// const dataArray = myOutput.result.dataSubChunk.channelData[0];

//TODO: calculate for each channel and sum them up(?)
console.log("DBs: ",calculateRMSDbs(dataArray));
drawLineChart(dataArray);


function calculateRMSDbs(dataArray) {
  let sum = 0;
  dataArray.forEach(value => {
    let sample = value / 32768;
    sum += (sample * sample);
  });
  const rms = Math.sqrt(sum / (dataArray.length / 2));
  const db = 20 * Math.log10(rms);
  return db;
}

function drawLineChart(dataArray) {
  const data = dataArray.map((value, index) => { return { key: index, value: value / 32768 }; });
  const line = d3nLine({ data: data });
  output('./examples/output', line, { width: 960, height: 550 });
}

function peak(audioChannelData) {
  const audioChannelDataAbs = audioChannelData.map(value => Math.abs(value));
  let max = audioChannelDataAbs[0];
  audioChannelDataAbs.forEach(value => {
    if(value > max) max = value;
  });
  return max;
}

function peakNormalize(audioChannelData, myCeroDb) {
  const mypeak = peak(audioChannelData);
  const factor = myCeroDb / mypeak;
  return audioChannelData.map(value => value * factor);
}
