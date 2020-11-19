const A = require('arcsecond');
const B = require('arcsecond-binary');
const fs = require('fs');
const path = require('path');
const d3nLine = require('d3node-linechart');
const output = require('d3node-output');

const MAX_VALUES = {
    BIT8: 128,
    BIT16: 32768,
    BIT32: 2147483648
  };

function calculateRMSDbsFromAWavPath(aWavFilePath) {
  const { channelsData, bitsPerSample } = obtainAudioDataFromWavFile(aWavFilePath);
  const maxValue = bitsPerSample == 8 ? MAX_VALUES.BIT8 : bitsPerSample == 16 ? MAX_VALUES.BIT16 : MAX_VALUES.BIT32;
  const data = stereoToMonoAvg(channelsData);
  const normalizedData = peakNormalize(data,maxValue);
  let sum = 0;
  normalizedData.forEach(value => {
    let sample = value / maxValue;
    sum += (sample * sample);
  });
  const rms = Math.sqrt(sum / normalizedData.length);
  const db = 20 * Math.log10(rms);
  return db;
}

function drawLineChart(aWavFilePath, outputPath) {
  const { channelsData, bitsPerSample } = obtainAudioDataFromWavFile(aWavFilePath);
  const maxValue = bitsPerSample == 8 ? MAX_VALUES.BIT8 : bitsPerSample == 16 ? MAX_VALUES.BIT16 : MAX_VALUES.BIT32;
  let data = peakNormalize(stereoToMonoAvg(channelsData), maxValue);
  data = data.map((value, index) => { return { key: index, value: value / maxValue }; });
  const line = d3nLine({ data: data });
  output(outputPath, line, { width: 960, height: 550 });
}

function stereoToMonoAvg(channelsData) {
  const left = channelsData[0];
  const right = channelsData[1];
  if (!right) return left;
  const monoData = [];
  for (let i = 0; i < left.length; i++) {
    monoData.push((left[i] + right[i]) / 2);
  }
  return monoData;
}



function peak(audioChannelData) {
  const audioChannelDataAbs = audioChannelData.map(value => Math.abs(value));
  let max = audioChannelDataAbs[0];
  audioChannelDataAbs.forEach(value => {
    if (value > max) max = value;
  });
  return max;
}

function peakNormalize(audioChannelData, maxValue) {
  const mypeak = peak(audioChannelData);
  const factor = maxValue / mypeak;
  return audioChannelData.map(value => value * factor);
}

function validateWavSize(file) {
    return B.u32LE.chain(size => {
      if (size !== file.length - 8) {
        return A.fail(`Invalid file size: ${file.length}. Expected ${size + 8}`);
      }
      return A.succeedWith(size);
    });
  }

function obtainAudioDataFromWavFile(aWavFilePath) {
  const file = fs.readFileSync(path.join(__dirname, aWavFilePath));
  const parser = generateParserForWavFile(file);
  const myOutput = parser.run(file.buffer);
  if (myOutput.isError) {
    console.log(myOutput.error);
    throw new Error(myOutput.error);
  }
  return { 
    channelsData: myOutput.result.dataSubChunk.channelData, 
    bitsPerSample: myOutput.data.bitsPerSample 
  };
}

function generateParserForWavFile(file) {
  const riffChunkSize = validateWavSize(file);
  const riffChunk = parseRiffChunk(riffChunkSize);
  const fmtSubChunk = parseFmtSubChunk();
  const dataSubChunk = parseDataSubChunk();
  return A.sequenceOf([
    riffChunk,
    fmtSubChunk,
    dataSubChunk
  ]).map(([riffChunk, fmtSubChunk, dataSubChunk]) => ({
    riffChunk,
    fmtSubChunk,
    dataSubChunk
  }));
}

function parseDataSubChunk() {
  return A.coroutine(function* () {
    const id = yield A.str('data');
    const size = yield B.u32LE;

    const fmtData = yield A.getData;

    const samples = size / fmtData.numChannels / (fmtData.bitsPerSample / 8);
    const channelData = Array.from({ length: fmtData.numChannels }, () => []);

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
}

function parseFmtSubChunk() {
  return A.coroutine(function* () {
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
}

function parseRiffChunk(riffChunkSize) {
  return A.sequenceOf([
    A.str('RIFF'),
    riffChunkSize,
    A.str('WAVE')
  ]);
}

exports.calculateRMSDbsFromAWavPath = calculateRMSDbsFromAWavPath;
exports.drawLineChartFromAWavPath = drawLineChart;