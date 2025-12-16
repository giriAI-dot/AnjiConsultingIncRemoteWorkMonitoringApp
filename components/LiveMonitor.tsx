import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MonitoringState, AnalysisResult, SessionLog } from '../types';
import { analyzeSessionContext } from '../services/geminiService';
import { 
    saveRecoveryChunks, 
    loadRecoveryChunks, 
    clearRecoveryChunks, 
    saveLogsToDB, 
    saveVideoToDB 
} from '../services/db';

// --- Global Declarations for MediaPipe ---
declare global {
  interface Window {
    SelfieSegmentation: any;
    Camera: any;
  }
}

// --- Types for Background Config ---
type BgMode = 'image' | 'blur' | 'none';

interface BgConfig {
    mode: BgMode;
    blurRadius: number;
    sourceType: 'default' | 'custom';
    customImage: HTMLImageElement | null;
}

// --- Logo Background Generator ---
const getLogoBackgroundInfo = () => {
    const svg = `
    <svg width="640" height="360" viewBox="0 0 640 360" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="360" fill="#111827"/>
      <!-- Background Pattern (Updated Hexagon Theme) -->
      <g opacity="0.1">
         <path d="M320 50 L500 150 V250 L320 350 L140 250 V150 Z" stroke="#F97316" stroke-width="2" fill="none"/>
         <path d="M320 180 L320 220" stroke="#F97316" stroke-width="4"/>
         <circle cx="320" cy="180" r="120" stroke="#F97316" stroke-width="2" stroke-dasharray="10 10"/>
         <circle cx="320" cy="180" r="4" fill="#F97316"/>
      </g>
      <!-- Logo Text Watermark -->
      <text x="320" y="320" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="24" fill="#F97316" opacity="0.4" letter-spacing="0.2em">ANJI CONSULTING</text>
    </svg>
    `;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    return img;
};

interface LiveMonitorProps {
  username: string;
  onSessionComplete: (sessionId: string, duration: number, logs: SessionLog[], videoBlobUrl?: string) => void;
}

export const LiveMonitor: React.FC<LiveMonitorProps> = ({ username, onSessionComplete }) => {
  const [status, setStatus] = useState<MonitoringState>(MonitoringState.IDLE);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryMeta, setRecoveryMeta] = useState<any>(null);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  
  // Idle Detection State
  const [isIdle, setIsIdle] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 Minutes
  
  // Background Settings State
  const [showBgSettings, setShowBgSettings] = useState(false);
  const [bgConfig, setBgConfig] = useState<BgConfig>(() => {
    // Load from localStorage on init
    try {
        const saved = localStorage.getItem('sw_bg_config');
        if (saved) {
            const parsed = JSON.parse(saved);
            let img = null;
            if (parsed.customImageSrc) {
                img = new Image();
                img.src = parsed.customImageSrc;
            }
            return {
                mode: parsed.mode || 'image',
                blurRadius: parsed.blurRadius || 12,
                sourceType: parsed.sourceType || 'default',
                customImage: img
            };
        }
    } catch (e) {
        console.error("Error loading saved bg config", e);
    }
    return {
        mode: 'image',
        blurRadius: 12,
        sourceType: 'default',
        customImage: null
    };
  });

  // Ref for access in callbacks
  const bgConfigRef = useRef(bgConfig);
  // Ref for camera state in callbacks
  const isCameraEnabledRef = useRef(isCameraEnabled);
  
  const videoRef = useRef<HTMLVideoElement>(null); // Screen Video
  const cameraVideoRef = useRef<HTMLVideoElement>(null); // Camera Video (Raw or Processed)
  const canvasRef = useRef<HTMLCanvasElement>(null); // Snapshot Canvas
  
  // MediaPipe Processing Refs
  const processedCanvasRef = useRef<HTMLCanvasElement>(null);
  const segmentationRef = useRef<any>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const isSegmentationReadyRef = useRef(false);
  
  // Streams
  const streamRef = useRef<MediaStream | null>(null); // Final Recording Stream
  const screenStreamRef = useRef<MediaStream | null>(null); 
  const rawCameraStreamRef = useRef<MediaStream | null>(null); 
  const processedCameraStreamRef = useRef<MediaStream | null>(null); 
  
  // Recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]); 
  const compositorCanvasRef = useRef<HTMLCanvasElement>(null); // For merging Screen + Camera
  
  const stateRef = useRef({ status, elapsedTime, logs });
  const timerRef = useRef<number | null>(null);
  const analysisIntervalRef = useRef<number | null>(null);
  const loopsRef = useRef<number[]>([]); // Cleanup intervals
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tracks session ID for DB persistence
  const [activeSessionId, setActiveSessionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    stateRef.current = { status, elapsedTime, logs };
  }, [status, elapsedTime, logs]);

  useEffect(() => {
    isCameraEnabledRef.current = isCameraEnabled;
  }, [isCameraEnabled]);

  // Activity Listeners for Idle Detection
  useEffect(() => {
    const handleActivity = () => {
        lastActivityRef.current = Date.now();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);
    window.addEventListener('touchstart', handleActivity); // Added for mobile

    return () => {
        window.removeEventListener('mousemove', handleActivity);
        window.removeEventListener('keydown', handleActivity);
        window.removeEventListener('click', handleActivity);
        window.removeEventListener('scroll', handleActivity);
        window.removeEventListener('touchstart', handleActivity);
    };
  }, []);

  // Check Idle Status Loop
  useEffect(() => {
    const checkIdleInterval = setInterval(() => {
        if (status !== MonitoringState.RECORDING) return;

        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        const currentlyIdle = timeSinceLastActivity > IDLE_THRESHOLD;

        setIsIdle(prevIdle => {
            if (prevIdle !== currentlyIdle) {
                // Status changed, log it
                const logMessage = currentlyIdle 
                    ? 'Idle detected: Reducing analysis frequency' 
                    : 'User Active: Resuming standard analysis';
                
                const newLog: SessionLog = {
                    id: Date.now().toString(),
                    resourceId: username,
                    timestamp: Date.now(),
                    type: 'activity',
                    category: currentlyIdle ? 'Idle' : 'Work',
                    isCameraOn: isCameraEnabledRef.current,
                    message: logMessage,
                    confidence: 'low',
                    // No thumbnail for status change logs usually
                };
                
                setLogs(prev => [newLog, ...prev]);
                
                return currentlyIdle;
            }
            return prevIdle;
        });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(checkIdleInterval);
  }, [status, username, IDLE_THRESHOLD]);

  useEffect(() => {
    bgConfigRef.current = bgConfig;
    
    // Persist settings to localStorage
    try {
        const toSave = {
            mode: bgConfig.mode,
            blurRadius: bgConfig.blurRadius,
            sourceType: bgConfig.sourceType,
            customImageSrc: bgConfig.customImage?.src || null
        };
        localStorage.setItem('sw_bg_config', JSON.stringify(toSave));
    } catch (e) {
        console.warn("Failed to save bg settings to storage", e);
    }
  }, [bgConfig]);

  useEffect(() => {
    // Load Logo Background
    backgroundImageRef.current = getLogoBackgroundInfo();

    const checkSavedSession = async () => {
      const meta = localStorage.getItem('sw_session_meta');
      if (meta) {
        const parsed = JSON.parse(meta);
        // Update to 3 days (3 * 24 * 60 * 60 * 1000 = 259200000 ms)
        if (Date.now() - parsed.timestamp < 259200000) { 
           setRecoveryMeta(parsed);
           setShowRecovery(true);
        }
      }
    };
    checkSavedSession();

    return () => {
      if (stateRef.current.status !== MonitoringState.IDLE) {
        saveSessionToStorage(stateRef.current.elapsedTime, stateRef.current.logs, chunksRef.current);
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
      stopLoops();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (status === MonitoringState.RECORDING || status === MonitoringState.PAUSED) {
        saveSessionToStorage(elapsedTime, logs, chunksRef.current);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [status, elapsedTime, logs]);

  // Update camera source when streams or config change
  useEffect(() => {
    if (status !== MonitoringState.IDLE) {
        if (videoRef.current && screenStreamRef.current) {
            videoRef.current.srcObject = screenStreamRef.current;
            videoRef.current.play().catch(e => console.debug("Auto-play prevented (screen)", e));
        }
        
        // Update Camera Preview source
        if (cameraVideoRef.current) {
            const streamToUse = (bgConfig.mode !== 'none' && processedCameraStreamRef.current) 
                ? processedCameraStreamRef.current 
                : rawCameraStreamRef.current;
                
            if (cameraVideoRef.current.srcObject !== streamToUse) {
                cameraVideoRef.current.srcObject = streamToUse;
                cameraVideoRef.current.play().catch(e => console.log("Auto-play prevented for PIP", e));
            }
        }
    }
  }, [status, bgConfig.mode]);

  const saveSessionToStorage = (time: number, currentLogs: SessionLog[], chunks: Blob[]) => {
      const meta = {
          elapsedTime: time,
          logs: currentLogs.map(l => { 
             // Strip thumbnail for lightweight meta storage in localStorage
             // Full logs are saved to DB
             const { thumbnail, ...rest } = l;
             return rest;
          }),
          timestamp: Date.now(),
          wasRecording: true
      };
      localStorage.setItem('sw_session_meta', JSON.stringify(meta));
      if (chunks.length > 0) {
          saveRecoveryChunks(chunks);
      }
      // Save full logs to DB
      if (currentLogs.length > 0) {
          saveLogsToDB(activeSessionId, currentLogs);
      }
  };

  const handleResumeSession = async () => {
      if (recoveryMeta) {
          setElapsedTime(recoveryMeta.elapsedTime);
          setLogs(recoveryMeta.logs);
          const savedChunks = await loadRecoveryChunks();
          chunksRef.current = savedChunks;
          
          // Reset activity timer
          lastActivityRef.current = Date.now();
          
          setStatus(MonitoringState.PAUSED); 
          setShowRecovery(false);
          setRecoveryMeta(null);
      }
  };

  const handleDiscardSession = async () => {
      await clearRecoveryChunks();
      localStorage.removeItem('sw_session_meta');
      setShowRecovery(false);
      setRecoveryMeta(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
              const img = new Image();
              img.src = event.target?.result as string;
              img.onload = () => {
                  setBgConfig(prev => ({
                      ...prev,
                      mode: 'image',
                      sourceType: 'custom',
                      customImage: img
                  }));
              };
          };
          reader.readAsDataURL(file);
      }
  };

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        resolve(base64String.split(',')[1]); 
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const onSegmentationResults = (results: any) => {
      if (!isSegmentationReadyRef.current) return;

      const canvas = processedCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const config = bgConfigRef.current;

      const width = canvas.width;
      const height = canvas.height;

      // Zoom Configuration
      const zoom = 1.35; 
      const offsetX = (width - width * zoom) / 2;
      const offsetY = (height - height * zoom) / 2 + (height * 0.1);

      ctx.save();
      ctx.clearRect(0, 0, width, height);

      // --- Mode: BLUR ---
      if (config.mode === 'blur') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(results.image, offsetX, offsetY, width * zoom, height * zoom);
          ctx.globalCompositeOperation = 'destination-in';
          ctx.filter = 'blur(2px)'; 
          ctx.drawImage(results.segmentationMask, offsetX, offsetY, width * zoom, height * zoom);
          ctx.filter = 'none';
          ctx.globalCompositeOperation = 'destination-over';
          ctx.filter = `blur(${config.blurRadius}px)`;
          ctx.drawImage(results.image, offsetX, offsetY, width * zoom, height * zoom);
          ctx.restore();
          return;
      }

      // --- Mode: IMAGE (Virtual Background) ---
      if (config.mode === 'image' || config.mode === 'none') {
          const bgImg = config.sourceType === 'custom' && config.customImage 
              ? config.customImage 
              : backgroundImageRef.current;
              
          if (bgImg) {
             ctx.drawImage(bgImg, 0, 0, width, height);
          } else {
             ctx.fillStyle = '#111827';
             ctx.fillRect(0, 0, width, height);
          }

          ctx.globalCompositeOperation = 'destination-out';
          ctx.filter = 'blur(4px)'; 
          ctx.drawImage(results.segmentationMask, offsetX, offsetY, width * zoom, height * zoom);
          ctx.filter = 'none';

          ctx.globalCompositeOperation = 'destination-over';
          ctx.drawImage(results.image, offsetX, offsetY, width * zoom, height * zoom);
          ctx.restore();
      }
  };

  const stopLoops = () => {
      loopsRef.current.forEach(id => clearInterval(id));
      loopsRef.current = [];
      
      isSegmentationReadyRef.current = false;

      if (segmentationRef.current) {
          const seg = segmentationRef.current;
          segmentationRef.current = null; 
          // Delay close to prevent "Aborted" if sending data concurrently
          setTimeout(() => {
              try { seg.close(); } catch (e) { console.debug("Error closing segmentation:", e); }
          }, 200);
      }
  };

  const captureAudioSnapshot = async (stream: MediaStream): Promise<{blob: Blob, mimeType: string} | null> => {
      if (stream.getAudioTracks().length === 0) return null;

      return new Promise((resolve) => {
          const mimeType = 'audio/webm';
          const options = MediaRecorder.isTypeSupported(mimeType) 
              ? { mimeType } 
              : undefined;
              
          try {
              const recorder = new MediaRecorder(stream, options);
              const chunks: Blob[] = [];
              recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
              recorder.onstop = () => {
                  const blob = new Blob(chunks, { type: recorder.mimeType });
                  resolve({ blob, mimeType: recorder.mimeType });
              };
              recorder.start();
              setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 2000);
          } catch (e) {
              resolve(null);
          }
      });
  };

  const startAnalysisLoop = useCallback(() => {
    if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);

    // Adjust frequency based on idle state: 15s (Active) vs 60s (Idle)
    const frequency = isIdle ? 60000 : 15000;

    analysisIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;

      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0);
        
        // Capture thumbnail (Low res)
        const thumbnailCanvas = document.createElement('canvas');
        thumbnailCanvas.width = 160;
        thumbnailCanvas.height = 90;
        const tCtx = thumbnailCanvas.getContext('2d');
        if (tCtx) tCtx.drawImage(canvasRef.current, 0, 0, 160, 90);
        const thumbnailBase64 = thumbnailCanvas.toDataURL('image/jpeg', 0.5);

        // Capture High Res for Gemini
        const imageBase64 = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
        
        let audioData = null;
        // Use RAW camera stream for audio snapshot
        if (rawCameraStreamRef.current && rawCameraStreamRef.current.active) {
            const snapshot = await captureAudioSnapshot(rawCameraStreamRef.current);
            if (snapshot) {
                const base64 = await blobToBase64(snapshot.blob);
                audioData = { base64, mimeType: snapshot.mimeType };
            }
        }

        const result = await analyzeSessionContext(imageBase64, audioData);
        setCurrentAnalysis(result);
        
        const newLog: SessionLog = {
          id: Date.now().toString(),
          resourceId: username,
          timestamp: Date.now(),
          type: result.category === 'Meeting' ? 'meeting' : 'activity',
          category: result.category, // Capture specific category
          isCameraOn: isCameraEnabledRef.current, // Capture camera state
          message: result.summary,
          confidence: result.riskLevel,
          thumbnail: thumbnailBase64 // Store the thumbnail
        };

        setLogs(prev => [newLog, ...prev]); 
      }
    }, frequency);
  }, [isIdle, username]);

  // Restart analysis loop when idle state changes to adjust frequency
  useEffect(() => {
      if (status === MonitoringState.RECORDING) {
          startAnalysisLoop();
      }
  }, [isIdle, status, startAnalysisLoop]);

  const startMonitoring = async () => {
    try {
      if (status === MonitoringState.IDLE) {
          chunksRef.current = [];
          setActiveSessionId(crypto.randomUUID());
      }

      // Reset idle timer
      lastActivityRef.current = Date.now();
      setIsIdle(false);

      // 1. Get Raw User Media (Camera + Mic)
      const userStream = await navigator.mediaDevices.getUserMedia({ 
        audio: true,
        video: { 
            width: { ideal: 640 }, 
            height: { ideal: 360 }, 
            facingMode: 'user' 
        }
      });
      rawCameraStreamRef.current = userStream;
      setIsCameraEnabled(true);

      // 2. Initialize MediaPipe Segmentation
      if (window.SelfieSegmentation && processedCanvasRef.current) {
          try {
              const segmentation = new window.SelfieSegmentation({locateFile: (file: string) => {
                  return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`;
              }});
              segmentation.setOptions({
                  modelSelection: 1, 
                  selfieMode: true, 
              });
              segmentation.onResults(onSegmentationResults);
              segmentationRef.current = segmentation;
              isSegmentationReadyRef.current = true;

              // Setup a dummy video to feed MediaPipe
              const dummyVideo = document.createElement('video');
              dummyVideo.srcObject = userStream;
              dummyVideo.muted = true; 
              dummyVideo.playsInline = true;
              await dummyVideo.play();
              
              if (processedCanvasRef.current) {
                  processedCanvasRef.current.width = 640;
                  processedCanvasRef.current.height = 360;
              }

              // Custom Loop for Segmentation (30 FPS)
              const segInterval = window.setInterval(async () => {
                  if (segmentationRef.current && dummyVideo.readyState >= 2 && isSegmentationReadyRef.current) {
                       // Only process if we need virtual background
                       if (bgConfigRef.current.mode !== 'none') {
                           try {
                               await segmentation.send({image: dummyVideo});
                           } catch(e) {
                               console.debug("Segmentation send error (ignored):", e);
                           }
                       }
                  }
              }, 33);
              loopsRef.current.push(segInterval);

          } catch (e) {
              console.error("MediaPipe Init Failed", e);
          }
      }

      // 3. Prepare Processed Stream
      if (processedCanvasRef.current) {
          processedCameraStreamRef.current = processedCanvasRef.current.captureStream(30);
      }

      // 4. Get Display Media (Screen)
      let screenStream: MediaStream;
      try {
          if (!navigator.mediaDevices?.getDisplayMedia) {
             throw new Error("getDisplayMedia not supported");
          }
          
          screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { width: 1280, height: 720 }, 
            audio: true 
          });
      } catch (err) {
          console.warn("Screen share unavailable (mobile or denied). Using fallback.", err);
          const fallbackCanvas = document.createElement('canvas');
          fallbackCanvas.width = 1280;
          fallbackCanvas.height = 720;
          const ctx = fallbackCanvas.getContext('2d');
          if (ctx) {
              ctx.fillStyle = '#1f2937'; 
              ctx.fillRect(0, 0, 1280, 720);
              ctx.fillStyle = '#9ca3af'; 
              ctx.font = 'bold 30px sans-serif';
              ctx.fillText('Screen Capture Unavailable', 100, 360);
          }
          screenStream = fallbackCanvas.captureStream(10); 
      }
      
      screenStreamRef.current = screenStream;

      // 5. Setup Compositor
      const compCanvas = compositorCanvasRef.current;
      if (compCanvas) {
          compCanvas.width = 1280;
          compCanvas.height = 720;
          
          const drawCompositor = () => {
              const ctx = compCanvas.getContext('2d');
              if (!ctx) return;
              
              if (videoRef.current && videoRef.current.readyState >= 2) {
                  ctx.drawImage(videoRef.current, 0, 0, 1280, 720);
              } else {
                  ctx.fillStyle = '#000';
                  ctx.fillRect(0, 0, 1280, 720);
              }

              const camVideo = cameraVideoRef.current;
              if (isCameraEnabled && camVideo && camVideo.readyState >= 2) {
                  const pipW = 320;
                  const pipH = 180;
                  const pipX = 1280 - pipW - 20;
                  const pipY = 720 - pipH - 20;
                  
                  ctx.save();
                  ctx.shadowColor = 'rgba(0,0,0,0.5)';
                  ctx.shadowBlur = 10;
                  ctx.strokeStyle = '#374151';
                  ctx.lineWidth = 2;
                  ctx.strokeRect(pipX, pipY, pipW, pipH);
                  ctx.drawImage(camVideo, pipX, pipY, pipW, pipH);
                  ctx.restore();
              }
          };

          const compInterval = window.setInterval(drawCompositor, 33);
          loopsRef.current.push(compInterval);
      }

      // 6. Create Final Recording Stream
      const recordingStream = compCanvas!.captureStream(30);
      const audioTracks = [
          ...userStream.getAudioTracks(),
          ...screenStream.getAudioTracks()
      ];
      audioTracks.forEach(track => recordingStream.addTrack(track));
      streamRef.current = recordingStream;

      const recorder = new MediaRecorder(recordingStream, {
          mimeType: 'video/webm;codecs=vp8,opus'
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data); 
        }
      };

      recorder.start(1000); 

      setStatus(MonitoringState.RECORDING);
      
      if (!timerRef.current) {
          timerRef.current = window.setInterval(() => {
            setElapsedTime(prev => prev + 1);
          }, 1000);
      }

      startAnalysisLoop();

      const screenVideoTrack = screenStream.getVideoTracks()[0];
      if (screenVideoTrack && screenVideoTrack.readyState === 'live' && !screenVideoTrack.label.includes('canvas')) {
          screenVideoTrack.onended = () => {
            stopMonitoring();
          };
      }

    } catch (err: any) {
      console.error("Error starting capture:", err);
      if (err.name === 'NotAllowedError') {
          alert("Permission denied. Please check Camera/Microphone permissions.");
      } else {
          alert(`Error accessing devices: ${err.message || 'Unknown error'}.`);
      }
    }
  };

  const pauseMonitoring = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
    }
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
    setStatus(MonitoringState.PAUSED);
    saveSessionToStorage(elapsedTime, logs, chunksRef.current);
  };

  const resumeMonitoring = () => {
    if (streamRef.current && streamRef.current.active) {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
            mediaRecorderRef.current.resume();
        }
        lastActivityRef.current = Date.now();
        setIsIdle(false);
        startAnalysisLoop();
        setStatus(MonitoringState.RECORDING);
    } else {
        startMonitoring();
    }
  };

  const toggleCamera = () => {
      setIsCameraEnabled(!isCameraEnabled);
  };

  const stopMonitoring = useCallback(async () => {
    // Stop streams
    [streamRef.current, screenStreamRef.current, rawCameraStreamRef.current, processedCameraStreamRef.current].forEach(stream => {
        if (stream) stream.getTracks().forEach(track => track.stop());
    });
    
    stopLoops();

    if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
    }
    if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
    }
    
    // Stop Recorder and handle data in onstop event to avoid race condition
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = async () => {
          let videoBlobUrl: string | undefined = undefined;
          const finalChunks = chunksRef.current;
          
          if (finalChunks.length > 0) {
              const blob = new Blob(finalChunks, { type: 'video/webm' });
              videoBlobUrl = URL.createObjectURL(blob);
              // Save complete video to DB for persistence
              await saveVideoToDB(activeSessionId, blob);
          }
          
          // Clean up storage
          await clearRecoveryChunks();
          localStorage.removeItem('sw_session_meta');
          
          // Pass correct sessionId to App to maintain consistency
          onSessionComplete(activeSessionId, elapsedTime, logs, videoBlobUrl);
          
          // Save final state with full logs to IDB
          if (logs.length > 0) {
              saveLogsToDB(activeSessionId, logs);
          }

          setElapsedTime(0);
          setLogs([]);
          setCurrentAnalysis(null);
          chunksRef.current = [];
      };
      
      mediaRecorderRef.current.stop();
    } else {
       // Fallback if recorder was not active
        setElapsedTime(0);
        setLogs([]);
        setCurrentAnalysis(null);
        chunksRef.current = [];
        localStorage.removeItem('sw_session_meta');
    }

    setStatus(MonitoringState.IDLE);
    setIsCameraEnabled(true);
    setIsIdle(false);

  }, [elapsedTime, onSessionComplete, logs, activeSessionId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:h-[calc(100vh-10rem)] relative">
      
      {/* Recovery Modal */}
      {showRecovery && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm rounded-2xl animate-fade-in">
              <div className="bg-gray-900 border border-indigo-500/50 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
                  <h3 className="text-xl font-bold text-white mb-2">Unsaved Session Found</h3>
                  <div className="grid grid-cols-2 gap-4 mt-6">
                      <button onClick={handleDiscardSession} className="px-4 py-2 rounded-lg border border-gray-700 text-gray-400">Discard</button>
                      <button onClick={handleResumeSession} className="px-4 py-2 rounded-lg bg-indigo-600 text-white">Resume</button>
                  </div>
              </div>
          </div>
      )}

      {/* Left Col: Video Feed */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-1 relative overflow-hidden group shadow-2xl">
          <div className="relative aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center">
             {status === MonitoringState.IDLE ? (
                 <div className="text-center">
                     <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                     </div>
                     <p className="text-gray-500">Monitoring inactive</p>
                 </div>
             ) : (
                 <>
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                    
                    {/* Camera Feed (PIP) - Responsive Size */}
                    <div className="absolute bottom-2 right-2 sm:bottom-4 sm:right-4 w-24 sm:w-40 md:w-48 aspect-video bg-gray-950 rounded-lg overflow-hidden border border-gray-700 shadow-xl z-20 transition-opacity duration-300 group/pip">
                        <video 
                            ref={cameraVideoRef} 
                            autoPlay 
                            playsInline 
                            muted 
                            className={`w-full h-full object-cover transition-opacity duration-300 ${isCameraEnabled ? 'opacity-100' : 'opacity-0'}`} 
                        />
                         {!isCameraEnabled && <div className="absolute inset-0 flex items-center justify-center text-[10px] sm:text-xs text-gray-500">Camera Off</div>}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-[8px] sm:text-[10px] text-white px-1 sm:px-2 py-0.5 text-center backdrop-blur-sm pointer-events-none">
                           {bgConfig.mode === 'none' ? 'Raw Camera' : 'Virtual BG Active'}
                        </div>
                    </div>
                 </>
             )}
             
             {/* Hidden Canvas elements */}
             <canvas ref={canvasRef} className="hidden" />
             <canvas ref={processedCanvasRef} className="hidden" />
             <canvas ref={compositorCanvasRef} className="hidden" />

             {status === MonitoringState.RECORDING && (
                 <div className="absolute top-4 left-4 flex gap-2 z-20">
                     <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg flex items-center gap-2 border border-white/10">
                        <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse"></div>
                        <span className="text-red-500 font-mono font-bold text-sm">REC</span>
                        <span className="text-white font-mono text-sm ml-2 hidden sm:inline">{formatTime(elapsedTime)}</span>
                     </div>
                     {isIdle && (
                         <div className="bg-yellow-500/20 backdrop-blur-md px-3 py-1.5 rounded-lg flex items-center gap-2 border border-yellow-500/30">
                            <span className="text-yellow-500 font-mono font-bold text-sm">IDLE</span>
                         </div>
                     )}
                 </div>
             )}
          </div>

          {/* Controls Bar - Moved outside absolute positioning for mobile to prevent overlap */}
          <div className={`
              w-full p-4 flex flex-wrap gap-3 justify-center items-center bg-gray-900/95 border-t border-gray-800 z-30
              lg:absolute lg:bottom-6 lg:left-1/2 lg:-translate-x-1/2 lg:w-auto lg:bg-transparent lg:border-none lg:p-0 
              lg:transition-opacity lg:duration-300
              ${status === MonitoringState.IDLE ? 'lg:opacity-0 lg:group-hover:opacity-100' : 'lg:opacity-100'}
          `}>
             {status === MonitoringState.IDLE ? (
                 <button onClick={startMonitoring} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-full font-medium shadow-lg shadow-indigo-500/20 flex items-center gap-2 transition-all transform hover:scale-105 whitespace-nowrap text-sm sm:text-base">
                     Start Session (8h Limit)
                 </button>
             ) : (
                <>
                    {status === MonitoringState.RECORDING ? (
                        <button onClick={pauseMonitoring} className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 sm:px-6 py-2 sm:py-2.5 rounded-full font-medium text-sm sm:text-base">Pause</button>
                    ) : (
                        <button onClick={resumeMonitoring} className="bg-green-600 hover:bg-green-500 text-white px-4 sm:px-6 py-2 sm:py-2.5 rounded-full font-medium text-sm sm:text-base">Resume</button>
                    )}
                    <button onClick={stopMonitoring} className="bg-red-600 hover:bg-red-500 text-white px-4 sm:px-6 py-2 sm:py-2.5 rounded-full font-medium text-sm sm:text-base">End</button>
                    <button onClick={toggleCamera} className="bg-gray-700 hover:bg-gray-600 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-full font-medium text-xs sm:text-sm whitespace-nowrap">
                        {isCameraEnabled ? 'Hide Cam' : 'Show Cam'}
                    </button>
                    
                    {/* Settings Button */}
                    <div className="relative">
                        <button 
                            onClick={() => setShowBgSettings(!showBgSettings)} 
                            className={`bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 sm:py-2.5 rounded-full font-medium text-sm border border-gray-600 ${showBgSettings ? 'ring-2 ring-indigo-500' : ''}`}
                            title="Camera Settings"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </button>
                        
                        {/* Settings Popover */}
                        {showBgSettings && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-4 z-50 animate-fade-in-up">
                                <h4 className="text-white text-sm font-semibold mb-3 border-b border-gray-800 pb-2">Camera Effects</h4>
                                
                                <div className="flex bg-gray-800 rounded-lg p-1 mb-4">
                                    <button 
                                        onClick={() => setBgConfig(p => ({...p, mode: 'blur'}))} 
                                        className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${bgConfig.mode === 'blur' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                    >Blur</button>
                                    <button 
                                        onClick={() => setBgConfig(p => ({...p, mode: 'image'}))} 
                                        className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${bgConfig.mode === 'image' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                    >Image</button>
                                    <button 
                                        onClick={() => setBgConfig(p => ({...p, mode: 'none'}))} 
                                        className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${bgConfig.mode === 'none' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                    >None</button>
                                </div>

                                {bgConfig.mode === 'blur' && (
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-gray-400">
                                            <span>Intensity</span>
                                            <span>{Math.round((bgConfig.blurRadius / 20) * 100)}%</span>
                                        </div>
                                        <input 
                                            type="range" 
                                            min="2" 
                                            max="20" 
                                            value={bgConfig.blurRadius} 
                                            onChange={(e) => setBgConfig(p => ({...p, blurRadius: parseInt(e.target.value)}))}
                                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                        />
                                    </div>
                                )}

                                {bgConfig.mode === 'image' && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <button 
                                            onClick={() => setBgConfig(p => ({...p, sourceType: 'default'}))}
                                            className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${bgConfig.sourceType === 'default' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-700 hover:border-gray-500'}`}
                                        >
                                            <div className="absolute inset-0 bg-gray-800 flex flex-col items-center justify-center">
                                                <span className="text-[10px] text-orange-500 font-bold">ANJI</span>
                                                <span className="text-[8px] text-gray-500">DEFAULT</span>
                                            </div>
                                        </button>
                                        
                                        <button 
                                            onClick={() => fileInputRef.current?.click()}
                                            className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all group ${bgConfig.sourceType === 'custom' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-700 hover:border-gray-500'}`}
                                        >
                                            {bgConfig.customImage ? (
                                                <img src={bgConfig.customImage.src} className="w-full h-full object-cover" alt="Custom" />
                                            ) : (
                                                <div className="absolute inset-0 bg-gray-800 flex flex-col items-center justify-center text-gray-400">
                                                    <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                                    </svg>
                                                    <span className="text-[8px]">UPLOAD</span>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-[10px] text-white">Change</span>
                                            </div>
                                        </button>
                                        <input 
                                            ref={fileInputRef}
                                            type="file" 
                                            accept="image/*" 
                                            className="hidden" 
                                            onChange={handleImageUpload}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
             )}
          </div>
        </div>

        {/* Live Analysis Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-sm">
            <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
                Real-time AI Context
            </h3>
            {status === MonitoringState.IDLE ? (
                <p className="text-gray-600 italic">Start session to enable Gemini analysis...</p>
            ) : currentAnalysis ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gray-800/50 p-4 rounded-lg">
                        <p className="text-xs text-gray-500 mb-1">Activity</p>
                        <p className="text-white font-medium">{currentAnalysis.category}</p>
                    </div>
                    <div className="bg-gray-800/50 p-4 rounded-lg">
                        <p className="text-xs text-gray-500 mb-1">Risk</p>
                        <p className={currentAnalysis.riskLevel === 'high' ? 'text-red-400 font-bold' : 'text-green-400'}>{currentAnalysis.riskLevel.toUpperCase()}</p>
                    </div>
                    <div className="bg-gray-800/50 p-4 rounded-lg">
                        <p className="text-xs text-gray-500 mb-1">Summary</p>
                        <p className="text-gray-300 text-sm">{currentAnalysis.summary}</p>
                    </div>
                </div>
            ) : (
                <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-800 rounded w-3/4"></div>
                </div>
            )}
        </div>
      </div>

      {/* Right Col: Activity Log (Scrollable) */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl flex flex-col overflow-hidden shadow-xl lg:h-auto h-96">
        <div className="p-4 border-b border-gray-800 bg-gray-900/95 backdrop-blur z-10">
            <h3 className="text-white font-semibold">Compliance Log</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {logs.length === 0 ? <p className="text-center text-gray-600 mt-10">No activity yet.</p> : 
                logs.slice().reverse().map(log => (
                    <div key={log.id} className="flex gap-3 text-sm">
                        <div className={`w-2 h-2 rounded-full mt-1.5 ${log.confidence === 'high' ? 'bg-red-500' : 'bg-green-500'}`}></div>
                        <div className="flex-1">
                            <div className="flex justify-between items-center mb-0.5">
                                <span className="text-gray-500 text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded border border-indigo-400/20">{log.resourceId || username}</span>
                            </div>
                            <p className="text-gray-300">{log.message}</p>
                        </div>
                    </div>
                ))
            }
        </div>
      </div>
    </div>
  );
};