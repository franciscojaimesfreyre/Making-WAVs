const A = require('arcsecond');
const B = require('arcsecond-binary');
const C = require('construct-js');
const fs = require('fs');
const path = require('path');
const d3nLine = require('d3node-linechart');
const output = require('d3node-output');

const maxValues = {
  BIT8: 128,
  BIT16: 32768,
  BIT32: 2147483648
};

const file = fs.readFileSync(path.join(__dirname, './testbed/audioCheck2.wav'));

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
  dataSubChunk
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
const BITS_PER_SAMPLE = myOutput.data.bitsPerSample;
const MAX_VALUE = BITS_PER_SAMPLE == 8? maxValues.BIT8 : BITS_PER_SAMPLE == 16? maxValues.BIT16 : maxValues.BIT32;
const channelsData = myOutput.result.dataSubChunk.channelData;

console.log("DBs: ",calculateRMSDbs(channelsData));
drawLineChart(peakNormalize(stereoToMonoAvg(channelsData)));


function calculateRMSDbs(channelsData) {
  const data = stereoToMonoAvg(channelsData);
  const normalizedData = peakNormalize(data);
  let sum = 0;
  normalizedData.forEach(value => {
    let sample = value / MAX_VALUE;
    sum += (sample * sample);
  });
  const rms = Math.sqrt(sum / (normalizedData.length / 2));
  const db = 20 * Math.log10(rms);
  return db;
}

function stereoToMonoAvg(channelsData) {
  const left = channelsData[0];
  const right = channelsData[1];
  if (!right) return left;
  const monoData = [];
  for(let i = 0; i < left.length; i++) {
    monoData.push((left[i]+right[i])/2);
  }
  return monoData;
}

function drawLineChart(dataArray) {
  const data = dataArray.map((value, index) => { return { key: index, value: value / MAX_VALUE }; });
  const line = d3nLine({ data: data });
  output('./charts/output', line, { width: 960, height: 550 });
}

function peak(audioChannelData) {
  const audioChannelDataAbs = audioChannelData.map(value => Math.abs(value));
  let max = audioChannelDataAbs[0];
  audioChannelDataAbs.forEach(value => {
    if(value > max) max = value;
  });
  return max;
}

function peakNormalize(audioChannelData) {
  const mypeak = peak(audioChannelData);
  const factor = MAX_VALUE / mypeak;
  return audioChannelData.map(value => value * factor);
}