import { useEffect, useRef, useState } from 'react';
import {
  Camera as CameraIcon,
  Check,
  Flashlight,
  Fingerprint,
  RotateCcw,
  Sun,
} from 'lucide-react';
import { Modal, Notice, Spinner } from './ui';

const ANALYSIS_WIDTH = 280;
const STABLE_FRAME_COUNT = 7;
const FRAME_INTERVAL_MS = 200;
const MAX_CAPTURE_WIDTH = 1200;

function getThumbCrop(videoWidth, videoHeight) {
  const shortSide = Math.min(videoWidth, videoHeight);
  let width = shortSide * 0.66;
  let height = width * 1.4;

  const maxHeight = videoHeight * 0.88;
  const maxWidth = videoWidth * 0.88;

  if (height > maxHeight) {
    height = maxHeight;
    width = height / 1.4;
  }
  if (width > maxWidth) {
    width = maxWidth;
    height = width * 1.4;
  }

  return {
    x: (videoWidth - width) / 2,
    y: (videoHeight - height) / 2,
    width,
    height,
  };
}

function drawThumbCrop(videoElement, canvas, requestedWidth = ANALYSIS_WIDTH) {
  if (!videoElement?.videoWidth || !videoElement?.videoHeight) return false;

  const crop = getThumbCrop(videoElement.videoWidth, videoElement.videoHeight);
  const outputLimit = requestedWidth || MAX_CAPTURE_WIDTH;
  const scale = Math.min(1, outputLimit / crop.width);
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(
    videoElement,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return true;
}

function isSkinPixel(red, green, blue) {
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  if (luminance < 28 || luminance > 248) return false;

  const cb = 128 - 0.168736 * red - 0.331264 * green + 0.5 * blue;
  const cr = 128 + 0.5 * red - 0.418688 * green - 0.081312 * blue;
  const yCbCrMatch = cb >= 62 && cb <= 155 && cr >= 116 && cr <= 190;

  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const rgbMatch =
    red >= green * 0.88 &&
    red >= blue * 0.88 &&
    maximum - minimum >= 6 &&
    red >= 42;

  return yCbCrMatch || rgbMatch;
}

function analyseFingerprint(canvas, previousFrame) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  const skinMask = new Uint8Array(width * height);

  let skinPixels = 0;
  let centreSkinPixels = 0;
  let centrePixelCount = 0;
  let brightnessSum = 0;
  let brightnessSquaredSum = 0;

  const centreLeft = Math.floor(width * 0.14);
  const centreRight = Math.ceil(width * 0.86);
  const centreTop = Math.floor(height * 0.08);
  const centreBottom = Math.ceil(height * 0.92);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const dataIndex = pixelIndex * 4;
      const red = pixels[dataIndex];
      const green = pixels[dataIndex + 1];
      const blue = pixels[dataIndex + 2];
      const value = 0.299 * red + 0.587 * green + 0.114 * blue;
      gray[pixelIndex] = value;

      const skin = isSkinPixel(red, green, blue);
      if (skin) {
        skinMask[pixelIndex] = 1;
        skinPixels += 1;
        brightnessSum += value;
        brightnessSquaredSum += value * value;
        if (
          x >= centreLeft &&
          x < centreRight &&
          y >= centreTop &&
          y < centreBottom
        ) {
          centreSkinPixels += 1;
        }
      }

      if (
        x >= centreLeft &&
        x < centreRight &&
        y >= centreTop &&
        y < centreBottom
      ) {
        centrePixelCount += 1;
      }
    }
  }

  const totalPixels = Math.max(1, width * height);
  const skinCoverage = skinPixels / totalPixels;
  const centreCoverage = centreSkinPixels / Math.max(1, centrePixelCount);
  const meanBrightness = brightnessSum / Math.max(1, skinPixels);
  const brightnessVariance = Math.max(
    0,
    brightnessSquaredSum / Math.max(1, skinPixels) - meanBrightness * meanBrightness,
  );
  const contrast = Math.sqrt(brightnessVariance);

  let laplacianSum = 0;
  let laplacianSquaredSum = 0;
  let edgePixels = 0;
  let sampledPixels = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!skinMask[index]) continue;

      const centre = gray[index];
      const laplacian =
        gray[index - 1] +
        gray[index + 1] +
        gray[index - width] +
        gray[index + width] -
        4 * centre;
      laplacianSum += laplacian;
      laplacianSquaredSum += laplacian * laplacian;

      const horizontal = Math.abs(gray[index + 1] - gray[index - 1]);
      const vertical = Math.abs(gray[index + width] - gray[index - width]);
      if (horizontal + vertical > 22) edgePixels += 1;
      sampledPixels += 1;
    }
  }

  const laplacianMean = laplacianSum / Math.max(1, sampledPixels);
  const sharpness = Math.max(
    0,
    laplacianSquaredSum / Math.max(1, sampledPixels) - laplacianMean * laplacianMean,
  );
  const edgeDensity = edgePixels / Math.max(1, sampledPixels);

  let motion = Infinity;
  if (previousFrame && previousFrame.length === gray.length) {
    let difference = 0;
    let compared = 0;
    for (let index = 0; index < gray.length; index += 2) {
      if (!skinMask[index]) continue;
      difference += Math.abs(gray[index] - previousFrame[index]);
      compared += 1;
    }
    motion = compared ? difference / compared : Infinity;
  }

  const fingerPresent = skinCoverage >= 0.12 && skinCoverage <= 0.97 && centreCoverage >= 0.14;
  const lightingOkay = meanBrightness >= 38 && meanBrightness <= 235;
  const contrastOkay = contrast >= 7.5;
  const ridgeDetailOkay = sharpness >= 9 && edgeDensity >= 0.018;
  const steady = motion <= 8.5;
  const qualityOkay =
    fingerPresent && lightingOkay && contrastOkay && ridgeDetailOkay && steady;

  let message = 'Place the pad of your thumb inside the oval.';
  if (fingerPresent && !lightingOkay) {
    message = meanBrightness < 38
      ? 'Too dark. Turn on the light or use the camera light.'
      : 'Too bright. Move away from direct light.';
  } else if (fingerPresent && !ridgeDetailOkay) {
    message = 'Finger detected. Move it slightly closer or farther until the lines become sharp.';
  } else if (fingerPresent && !contrastOkay) {
    message = 'Fingerprint lines are faint. Use even light and adjust your thumb.';
  } else if (fingerPresent && !steady) {
    message = 'Lines detected. Hold your thumb flat and completely still.';
  } else if (qualityOkay) {
    message = 'Clear fingerprint detail detected. Hold still while the photo is taken.';
  }

  return {
    gray,
    fingerPresent,
    lightingOkay,
    contrastOkay,
    ridgeDetailOkay,
    steady,
    qualityOkay,
    sharpness,
    edgeDensity,
    skinCoverage,
    message,
  };
}

function findThumbBounds(imageData) {
  const { width, height, data } = imageData;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  let skinCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!isSkinPixel(data[index], data[index + 1], data[index + 2])) continue;
      skinCount += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  const coverage = skinCount / Math.max(1, width * height);
  if (right <= left || bottom <= top || coverage < 0.08) {
    return { x: 0, y: 0, width, height };
  }

  const marginX = Math.round((right - left) * 0.055);
  const marginY = Math.round((bottom - top) * 0.045);
  const x = Math.max(0, left - marginX);
  const y = Math.max(0, top - marginY);
  const farX = Math.min(width - 1, right + marginX);
  const farY = Math.min(height - 1, bottom + marginY);

  return {
    x,
    y,
    width: Math.max(1, farX - x + 1),
    height: Math.max(1, farY - y + 1),
  };
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let maximumVariance = -1;
  let threshold = 127;

  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance =
      backgroundWeight * foregroundWeight *
      (backgroundMean - foregroundMean) *
      (backgroundMean - foregroundMean);
    if (variance > maximumVariance) {
      maximumVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function processThumbImage(sourceCanvas) {
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const sourceImage = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bounds = findThumbBounds(sourceImage);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = bounds.width;
  outputCanvas.height = bounds.height;

  const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
  const croppedImage = sourceContext.getImageData(
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  );
  const { width, height, data } = croppedImage;
  const pixelCount = width * height;
  const gray = new Uint8Array(pixelCount);
  const histogram = new Uint32Array(256);

  for (let pixel = 0, dataIndex = 0; pixel < pixelCount; pixel += 1, dataIndex += 4) {
    const value = Math.round(
      0.299 * data[dataIndex] +
      0.587 * data[dataIndex + 1] +
      0.114 * data[dataIndex + 2],
    );
    gray[pixel] = value;
    histogram[value] += 1;
  }

  const lowTarget = Math.floor(pixelCount * 0.02);
  const highTarget = Math.floor(pixelCount * 0.98);
  let cumulative = 0;
  let low = 0;
  let high = 255;

  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= lowTarget) {
      low = value;
      break;
    }
  }

  cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= highTarget) {
      high = value;
      break;
    }
  }

  const range = Math.max(30, high - low);
  const stretched = new Uint8Array(pixelCount);
  const stretchedHistogram = new Uint32Array(256);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const value = Math.max(0, Math.min(255, Math.round(((gray[pixel] - low) * 255) / range)));
    stretched[pixel] = value;
    stretchedHistogram[value] += 1;
  }

  // Local adaptive thresholding brings out fine ridge detail under uneven lighting.
  const integralWidth = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += stretched[(y - 1) * width + (x - 1)];
      integral[y * integralWidth + x] =
        integral[(y - 1) * integralWidth + x] + rowSum;
    }
  }

  const radius = Math.max(9, Math.round(Math.min(width, height) * 0.035));
  const output = outputContext.createImageData(width, height);
  let blackPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width, x + radius + 1);
      const area = (x2 - x1) * (y2 - y1);
      const sum =
        integral[y2 * integralWidth + x2] -
        integral[y1 * integralWidth + x2] -
        integral[y2 * integralWidth + x1] +
        integral[y1 * integralWidth + x1];
      const localMean = sum / Math.max(1, area);
      const value = stretched[y * width + x];
      const isBlack = value < localMean - 5;
      const outputValue = isBlack ? 0 : 255;
      if (isBlack) blackPixels += 1;
      const index = (y * width + x) * 4;
      output.data[index] = outputValue;
      output.data[index + 1] = outputValue;
      output.data[index + 2] = outputValue;
      output.data[index + 3] = 255;
    }
  }

  const blackRatio = blackPixels / Math.max(1, pixelCount);
  if (blackRatio < 0.025 || blackRatio > 0.62) {
    const threshold = otsuThreshold(stretchedHistogram, pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const outputValue = stretched[pixel] <= threshold ? 0 : 255;
      const index = pixel * 4;
      output.data[index] = outputValue;
      output.data[index + 1] = outputValue;
      output.data[index + 2] = outputValue;
      output.data[index + 3] = 255;
    }
  }

  outputContext.putImageData(output, 0, 0);
  return output;
}

function imageDataToBlob(imageData, inverted = false) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Could not prepare the fingerprint image.'));
      return;
    }

    const output = context.createImageData(imageData.width, imageData.height);
    output.data.set(imageData.data);
    if (inverted) {
      for (let index = 0; index < output.data.length; index += 4) {
        const value = 255 - output.data[index];
        output.data[index] = value;
        output.data[index + 1] = value;
        output.data[index + 2] = value;
      }
    }
    context.putImageData(output, 0, 0);
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create the image file.'))),
      'image/jpeg',
      0.98,
    );
  });
}

export function Camera({ kind, onCapture, onClose }) {
  const video = useRef(null);
  const stream = useRef(null);
  const capturing = useRef(false);
  const previousFrame = useRef(null);
  const stableFrames = useRef(0);
  const processedImage = useRef(null);
  const captureFunction = useRef(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Opening camera...');
  const [torch, setTorch] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [inverted, setInverted] = useState(false);

  const isThumb = kind !== 'photo';

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access requires HTTPS or localhost.');
        }

        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });

        if (cancelled) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream.current = cameraStream;
        const track = cameraStream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.();
        setTorchAvailable(Boolean(capabilities?.torch));

        if (capabilities?.focusMode?.includes?.('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        }

        if (!video.current) throw new Error('Camera preview could not be started.');
        video.current.srcObject = cameraStream;
        await video.current.play();

        if (!cancelled) {
          setReady(true);
          setStatus(isThumb ? 'Place the pad of your thumb inside the oval.' : 'Camera ready.');
        }
      } catch (cameraError) {
        if (!cancelled) {
          setError(cameraError.message || 'Camera unavailable. Allow camera access and try again.');
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [isThumb]);

  useEffect(() => {
    if (!url) return undefined;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  function drawFullResolutionFrame(canvas) {
    const currentVideo = video.current;
    if (!currentVideo?.videoWidth || !currentVideo?.videoHeight) return false;

    if (isThumb) return drawThumbCrop(currentVideo, canvas, MAX_CAPTURE_WIDTH);

    canvas.width = currentVideo.videoWidth;
    canvas.height = currentVideo.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
    return true;
  }

  async function createThumbPreview() {
    if (capturing.current || !ready) return;
    capturing.current = true;
    setProcessing(true);
    setStatus('Taking the photo and enhancing fingerprint lines...');

    try {
      const canvas = document.createElement('canvas');
      if (!drawFullResolutionFrame(canvas)) {
        throw new Error('Camera is not ready. Please try again.');
      }

      const imageData = processThumbImage(canvas);
      processedImage.current = imageData;
      const capturedBlob = await imageDataToBlob(imageData, false);
      const nextUrl = URL.createObjectURL(capturedBlob);
      setBlob(capturedBlob);
      setUrl(nextUrl);
      setInverted(false);
      setProgress(1);
      setStatus('Scan complete. Check the fingerprint lines before using it.');
    } catch (captureError) {
      setError(captureError.message || 'Fingerprint image could not be processed. Try again.');
    } finally {
      capturing.current = false;
      setProcessing(false);
    }
  }

  function capturePhoto() {
    if (capturing.current || !ready) return;
    capturing.current = true;
    setProcessing(true);
    setStatus('Preparing image...');

    const canvas = document.createElement('canvas');
    if (!drawFullResolutionFrame(canvas)) {
      capturing.current = false;
      setProcessing(false);
      setError('Camera is not ready. Please try again.');
      return;
    }

    canvas.toBlob(
      (capturedBlob) => {
        capturing.current = false;
        setProcessing(false);
        if (!capturedBlob) {
          setError('The camera could not create an image. Please try again.');
          return;
        }
        setBlob(capturedBlob);
        setUrl(URL.createObjectURL(capturedBlob));
        setProgress(1);
        setStatus('Image captured.');
      },
      'image/jpeg',
      0.96,
    );
  }

  captureFunction.current = isThumb ? createThumbPreview : capturePhoto;

  useEffect(() => {
    if (!ready || !isThumb || blob || error) return undefined;

    const analysisCanvas = document.createElement('canvas');
    let stopped = false;

    const timer = window.setInterval(() => {
      if (stopped || capturing.current) return;
      if (!drawThumbCrop(video.current, analysisCanvas, ANALYSIS_WIDTH)) return;

      const result = analyseFingerprint(analysisCanvas, previousFrame.current);
      previousFrame.current = result.gray;

      if (!result.qualityOkay) {
        stableFrames.current = 0;
        setProgress(0);
        setStatus(result.message);
        return;
      }

      stableFrames.current += 1;
      const nextProgress = Math.min(stableFrames.current / STABLE_FRAME_COUNT, 1);
      setProgress(nextProgress);
      setStatus(result.message);

      if (stableFrames.current >= STABLE_FRAME_COUNT) {
        stopped = true;
        window.clearInterval(timer);
        captureFunction.current?.();
      }
    }, FRAME_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      previousFrame.current = null;
      stableFrames.current = 0;
    };
  }, [ready, isThumb, blob, error]);

  useEffect(() => {
    if (!isThumb || !blob || !processedImage.current) return undefined;
    let cancelled = false;

    imageDataToBlob(processedImage.current, inverted)
      .then((nextBlob) => {
        if (cancelled) return;
        setBlob(nextBlob);
        setUrl(URL.createObjectURL(nextBlob));
      })
      .catch((processingError) => {
        if (!cancelled) setError(processingError.message || 'Could not update the print image.');
      });

    return () => {
      cancelled = true;
    };
  }, [inverted]);

  async function toggleLight() {
    try {
      const track = stream.current?.getVideoTracks()[0];
      if (!track || !torchAvailable) {
        setStatus('This camera has no built-in light. Use a bright, even light source.');
        return;
      }
      await track.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch((current) => !current);
    } catch {
      setStatus('Camera light is unavailable. Use a bright, even light source.');
    }
  }

  function retake() {
    if (url) URL.revokeObjectURL(url);
    processedImage.current = null;
    previousFrame.current = null;
    stableFrames.current = 0;
    capturing.current = false;
    setBlob(null);
    setUrl('');
    setError('');
    setProgress(0);
    setInverted(false);
    setStatus('Place the pad of your thumb inside the oval.');
  }

  function acceptCapture() {
    if (!blob) return;
    const fileName = `${kind}-${Date.now()}.jpg`;
    onCapture(new File([blob], fileName, { type: 'image/jpeg' }));
    onClose();
  }

  return (
    <Modal title={isThumb ? 'Thumb impression' : 'Take photo'} onClose={onClose}>
      <style>{`
        .thumb-camera-workflow { display:flex; flex-direction:column; gap:12px; }
        .thumb-camera-stage { position:relative; width:min(100%, 390px); height:min(56vh, 450px); min-height:300px; margin:0 auto; overflow:hidden; border-radius:13px; background:#05080b; display:grid; place-items:center; }
        .thumb-camera-stage video { width:100%; height:100%; object-fit:cover; display:block; }
        .thumb-camera-stage .thumb-live-oval { position:absolute; left:50%; top:50%; width:49%; height:70%; transform:translate(-50%,-50%); border:3px solid #e0b54c; border-radius:50%; box-shadow:0 0 0 999px rgba(0,0,0,.48); pointer-events:none; transition:border-color .18s ease, box-shadow .18s ease; }
        .thumb-camera-stage .thumb-live-oval.detected { border-color:#66d2a0; }
        .thumb-camera-stage .thumb-live-oval.ready { border-color:#35d59a; box-shadow:0 0 0 999px rgba(0,0,0,.42), 0 0 18px rgba(53,213,154,.45); }
        .thumb-camera-stage .thumb-live-message { position:absolute; top:18px; left:50%; transform:translateX(-50%); width:max-content; max-width:90%; padding:9px 14px; border-radius:22px; background:rgba(0,0,0,.68); color:#f3c65c; font-size:12px; text-align:center; pointer-events:none; }
        .thumb-camera-stage .thumb-live-message.detected { color:#9fe4c4; }
        .thumb-camera-stage .thumb-stage-hint { position:absolute; bottom:0; left:0; right:0; padding:12px 14px; background:rgba(0,0,0,.72); color:#f4f4f4; font-size:11px; line-height:1.5; text-align:center; pointer-events:none; }
        .thumb-camera-stage .thumb-stage-spinner { position:absolute; inset:0; display:grid; place-items:center; color:white; pointer-events:none; }
        .thumb-camera-status { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#637b88; font-size:11px; line-height:1.5; }
        .thumb-progress-track { height:5px; width:100%; overflow:hidden; border-radius:8px; background:#e9efef; }
        .thumb-progress-track span { display:block; height:100%; border-radius:8px; background:#0b8977; transition:width .18s ease; }
        .thumb-result-frame { width:min(100%, 390px); height:min(56vh, 450px); min-height:300px; margin:0 auto; display:grid; place-items:center; overflow:hidden; border-radius:13px; background:#e9e9e9; }
        .thumb-result-frame img { width:100%; height:100%; object-fit:contain; display:block; }
        .thumb-result-note { display:flex; align-items:flex-start; gap:8px; padding:11px 12px; border-radius:9px; background:#eff9f2; color:#426b54; font-size:11px; line-height:1.5; }
        .thumb-result-note svg { flex:0 0 auto; margin-top:1px; color:#17956c; }
        .thumb-result-actions { display:flex; flex-wrap:wrap; gap:9px; }
        .thumb-result-actions .btn { flex:1 1 auto; justify-content:center; }
        .thumb-light-row { display:flex; justify-content:center; }
        .thumb-light-row .btn { font-size:11px; }
        @media (max-width: 520px) {
          .thumb-camera-stage, .thumb-result-frame { width:100%; height:min(54vh, 430px); min-height:280px; }
          .thumb-camera-stage .thumb-live-oval { width:54%; height:70%; }
          .thumb-result-actions { display:grid; grid-template-columns:1fr 1fr; }
          .thumb-result-actions .btn:last-child { grid-column:1 / -1; }
        }
      `}</style>

      <div className="modal-body">
        {error && <Notice error>{error}</Notice>}

        {isThumb ? (
          <div className="thumb-camera-workflow">
            {blob ? (
              <>
                <div className="thumb-result-frame">
                  <img src={url} alt="Enhanced thumb impression" />
                </div>
                <div className="thumb-result-note" role="status">
                  <Check size={16} />
                  <span>
                    <strong>Scan complete.</strong> Check that the fingerprint lines are clear before using this print.
                  </span>
                </div>
                <div className="thumb-result-actions">
                  <button className="btn secondary" type="button" onClick={() => setInverted((value) => !value)}>
                    <Sun size={16} />
                    Swap black and white
                  </button>
                  <button className="btn secondary" type="button" onClick={retake}>
                    <RotateCcw size={16} />
                    Try again
                  </button>
                  <button className="btn primary" type="button" onClick={acceptCapture}>
                    <Check size={16} />
                    Use this print
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="thumb-camera-stage">
                  <video ref={video} playsInline muted />
                  {ready && (
                    <>
                      <div
                        className={
                          'thumb-live-oval' +
                          (progress > 0 ? ' detected' : '') +
                          (progress >= 1 ? ' ready' : '')
                        }
                      />
                      <div className={'thumb-live-message' + (progress > 0 ? ' detected' : '')}>
                        {processing ? 'Taking the photo...' : progress >= 1 ? 'Scan complete' : 'Position your thumb'}
                      </div>
                      <div className="thumb-stage-hint">
                        Hold your thumb flat, pad facing the camera and inside the oval. Use a bright light if needed.
                      </div>
                    </>
                  )}
                  {!ready && !error && <div className="thumb-stage-spinner"><Spinner /></div>}
                </div>
                <div className="thumb-camera-status" role="status" aria-live="polite">
                  <span>{status}</span>
                  <span>{Math.round(progress * 100)}%</span>
                </div>
                <div className="thumb-progress-track" aria-hidden="true">
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="thumb-light-row">
                  <button className="btn secondary" type="button" onClick={toggleLight} disabled={!ready}>
                    <Flashlight size={16} />
                    {torchAvailable ? (torch ? 'Turn light off' : 'Turn light on') : 'Lighting tips'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="camera-view">
              <video ref={video} playsInline muted style={{ display: blob ? 'none' : 'block' }} />
              {blob ? <img src={url} alt="Captured image" /> : null}
              {!ready && !error && <Spinner />}
            </div>
            <div className="button-row camera-buttons">
              {blob ? (
                <>
                  <button className="btn secondary" type="button" onClick={retake}>
                    <RotateCcw size={16} /> Retake
                  </button>
                  <button className="btn primary" type="button" onClick={acceptCapture}>
                    <Check size={16} /> Use image
                  </button>
                </>
              ) : (
                <>
                  {torchAvailable && (
                    <button className="btn secondary" type="button" onClick={toggleLight}>
                      <Flashlight size={16} /> {torch ? 'Light off' : 'Light'}
                    </button>
                  )}
                  <button className="btn primary" type="button" disabled={!ready || processing} onClick={capturePhoto}>
                    {processing ? <Spinner /> : <CameraIcon size={17} />} Capture
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {isThumb && blob && (
          <small className="camera-disclosure">
            Camera-enhanced thumb impression image. This does not verify a person’s identity or create a biometric match.
          </small>
        )}
      </div>
    </Modal>
  );
}
