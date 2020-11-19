const analyzer = require('./wavAnalyzer');
const fs = require('fs');
const converter = require('json-2-csv');
const util = require('util');
const readdir = util.promisify(fs.readdir);

const drawLineCharts = (file) => 
  analyzer.drawLineChartFromAWavPath(
    file, 
    `./charts/output_${file.split('/')[2].split('.')[0]}`
  );

const logDBs = (filePath) => 
  console.log("DBs: ", analyzer.calculateRMSDbsFromAWavPath(filePath));

const returnDbRows = (filePath) => { 
  return { 
    fileName: filePath.split('/')[2], 
    dBs: analyzer.calculateRMSDbsFromAWavPath(filePath) 
  };
};

async function overFilesInFolderDo(folderPath, someFunction) {
  const fileNames = await readdir(folderPath);
  return fileNames.map((fileName) => someFunction(`${folderPath}/${fileName}`));
}

const program = async (wavFilesFolerPath) => {
  const dbRows = await overFilesInFolderDo(wavFilesFolerPath, returnDbRows);
  console.log(dbRows);

  let json2csvCallback = function (err, csv) {
    if (err) throw err;
    fs.writeFile('results.csv', csv, 'utf8', function(err) {
      if (err) {
        console.log('Some error occured - file either not saved or corrupted file saved.');
      } else {
        console.log('It\'s saved!');
      }
    });
  };
  
  converter.json2csv(dbRows, json2csvCallback, {
  prependHeader: true
  });
}
program('./testbed');


