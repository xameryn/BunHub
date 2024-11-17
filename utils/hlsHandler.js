const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const HLS_DIR = path.join(__dirname, '..', 'hls');

// Ensure HLS directory exists
if (!fs.existsSync(HLS_DIR)) {
  fs.mkdirSync(HLS_DIR, { recursive: true });
}

function generateHLS(inputPath, filename) {
  const outputPath = path.join(HLS_DIR, path.parse(filename).name);
  
  console.log('Generating HLS stream:', {
    inputPath,
    filename,
    outputPath
  });

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-profile:v baseline',
        '-level 3.0',
        '-start_number 0',
        '-hls_time 10',
        '-hls_list_size 0',
        '-f hls'
      ])
      .output(path.join(outputPath, 'playlist.m3u8'))
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log('Processing:', progress.percent, '% done');
      })
      .on('end', () => {
        const hlsUrl = `/hls/${path.parse(filename).name}/playlist.m3u8`;
        console.log('HLS generation complete:', hlsUrl);
        resolve(hlsUrl);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}

module.exports = {
  generateHLS,
  HLS_DIR
}; 