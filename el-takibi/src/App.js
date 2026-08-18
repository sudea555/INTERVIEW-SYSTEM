import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';

const ALL_TASKS = [
  { id: 'triangle', title:  'Üçgen Çiz', desc: 'İşaret ve başparmağını birleştirerek havada üçgen çiz.' },
  { id: 'clap', title: 'Alkış Yap', desc: 'Ellerini birbirine yaklaştırarak alkış hareketi yap.' },
  { id: 'fist', title: ' Yumruk Yap', desc: 'Elini kapatarak yumruk yap ve kameraya göster.' },
  { id: 'three', title: ' İşaretle 3 Yap', desc: 'İşaret, orta ve yüzük parmağını kaldırarak "3" işareti yap.' },
];


const REQUIRED_STEPS = 4;
const TIME_LIMIT_SEC = 15;

function App() {
  const videoRef = useRef(null);
  const cameraCanvasRef = useRef(null);
  const drawCanvasRef = useRef(null);

  const previousPointRef = useRef(null);
  const currentStrokeRef = useRef([]);
  const isDrawingRef = useRef(false);
  const finishTimeoutRef = useRef(null);

  const smoothedPosRef = useRef(null);

  const releaseFrameCountRef = useRef(0);
  const lostFrameCountRef = useRef(0);

  const [selectedTasks, setSelectedTasks] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT_SEC);
  const [feedback, setFeedback] = useState('');
  const [borderRed, setBorderRed] = useState(false);

  const currentStepRef = useRef(currentStep);
  const selectedTasksRef = useRef(selectedTasks);
  const phaseRef = useRef(phase);

  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { selectedTasksRef.current = selectedTasks; }, [selectedTasks]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const timerIntervalRef = useRef(null);
  const cameraRef = useRef(null);
  const handsRef = useRef(null);

  const startTest = () => {
    const shuffled = [...ALL_TASKS].sort(() => 0.5 - Math.random());
    setSelectedTasks(shuffled);
    setCurrentStep(0);
    setTimeLeft(TIME_LIMIT_SEC);
    setFeedback('');
    setPhase('running');
  };

  useEffect(() => {
    if (phase !== 'running') {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }
    timerIntervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          setPhase('fail');
          setFeedback('⏱️ Süre doldu! Test başarısız.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [phase]);

  const handleStepSuccess = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);

    const drawCanvas = drawCanvasRef.current;
    if (drawCanvas) {
      drawCanvas.getContext('2d').clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }
    currentStrokeRef.current = [];
    isDrawingRef.current = false;
    setBorderRed(false);
    smoothedPosRef.current = null;
    previousPointRef.current = null;
    releaseFrameCountRef.current = 0;
    lostFrameCountRef.current = 0;

    const tasks = selectedTasksRef.current;
    if (currentStepRef.current < tasks.length - 1) {
      setPhase('success_flash');
      setFeedback('✅ Harika! Sonraki göreve geçiliyor...');
      setTimeout(() => {
        setCurrentStep(prev => prev + 1);
        setTimeLeft(TIME_LIMIT_SEC);
        setFeedback('');
        setPhase('running');
      }, 1200);
    } else {
      setPhase('verified');
      setFeedback('🎉 Tebrikler! Tüm canlılık testleri başarıyla tamamlandı. Mülakata katılabilirsiniz.');
    }
  }, []);

  // Geliştirilmiş Üçgen Doğrulama Fonksiyonu (Düzeltildi)
  const checkTriangle = (points) => {
    if (!points || points.length < 30) return false;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const width = maxX - minX;
    const height = maxY - minY;

    if (width < 50 || height < 50) return false;

    const startPoint = points[0];
    const endPoint = points[points.length - 1];
    const closureDistance = Math.hypot(startPoint.x - endPoint.x, startPoint.y - endPoint.y);
    const maxDimension = Math.max(width, height);
    
    if (closureDistance > maxDimension * 0.45) {
      return false; 
    }

    let corners = [];
    const step = 6;

    for (let i = step; i < points.length - step; i += 2) {
      const p1 = points[i - step];
      const p2 = points[i];
      const p3 = points[i + step];

      const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
      const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

      const dot = v1.x * v2.x + v1.y * v2.y;
      const mag1 = Math.hypot(v1.x, v1.y);
      const mag2 = Math.hypot(v2.x, v2.y);

      if (mag1 > 0 && mag2 > 0) {
        let cosTheta = dot / (mag1 * mag2);
        cosTheta = Math.max(-1, Math.min(1, cosTheta));
        const angle = Math.acos(cosTheta);

        if (angle > 0.45) {
          corners.push(i);
          i += 10;
        }
      }
    }

    return corners.length >= 2 && corners.length <= 4;
  };

  useEffect(() => {
    const videoElement = videoRef.current;
    const cameraCanvas = cameraCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;

    if (!videoElement || !cameraCanvas || !drawCanvas) return;

    const cameraCtx = cameraCanvas.getContext('2d');
    const drawCtx = drawCanvas.getContext('2d');

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    handsRef.current = hands;

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults((results) => {
     
      if (!cameraCanvasRef.current) return;
      cameraCtx.save();
      cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
      cameraCtx.translate(cameraCanvas.width, 0);
      cameraCtx.scale(-1, 1);
      cameraCtx.drawImage(results.image, 0, 0, cameraCanvas.width, cameraCanvas.height);
      cameraCtx.restore();

      if (phaseRef.current !== 'running') return;

      const tasks = selectedTasksRef.current;
      const currentTask = tasks[currentStepRef.current];
      if (!currentTask) return;

      const landmarksList = results.multiHandLandmarks;

      if (currentTask.id === 'triangle') {
        const scheduleFinishEvaluation = () => {
          if (finishTimeoutRef.current) return;
          finishTimeoutRef.current = setTimeout(() => {
            if (checkTriangle(currentStrokeRef.current)) {
              handleStepSuccess();
            } else {
              setFeedback('⚠️ Lütfen belirgin bir üçgen çiz ve şekli kapat!');
              setTimeout(() => setFeedback(''), 1500);
              drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            }
            currentStrokeRef.current = [];
            isDrawingRef.current = false;
            setBorderRed(false);
            finishTimeoutRef.current = null;
            releaseFrameCountRef.current = 0;
            lostFrameCountRef.current = 0;
          }, 400); 
          
        };

        if (landmarksList && landmarksList.length > 0) {
          lostFrameCountRef.current = 0; 

          const hand = landmarksList[0];

          const rawX = (1 - hand[8].x) * cameraCanvas.width;
          const rawY = hand[8].y * cameraCanvas.height;
          const thumbX = (1 - hand[4].x) * cameraCanvas.width;
          const thumbY = hand[4].y * cameraCanvas.height;

          if (!smoothedPosRef.current) {
            smoothedPosRef.current = { x: rawX, y: rawY };
          } else {
            smoothedPosRef.current.x += (rawX - smoothedPosRef.current.x) * 0.55;
            smoothedPosRef.current.y += (rawY - smoothedPosRef.current.y) * 0.55;
          }

          const x = smoothedPosRef.current.x;
          const y = smoothedPosRef.current.y;

          const distance = Math.hypot(x - thumbX, y - thumbY);

          const PINCH_START = 55; 
          const PINCH_END = 90;   

          const shouldDraw = isDrawingRef.current
            ? distance < PINCH_END
            : distance < PINCH_START;

          if (shouldDraw) {
            releaseFrameCountRef.current = 0; 
            if (finishTimeoutRef.current) {
              clearTimeout(finishTimeoutRef.current);
              finishTimeoutRef.current = null;
            }
            if (!isDrawingRef.current) {
              isDrawingRef.current = true;
              setBorderRed(true);
              currentStrokeRef.current = [];
              previousPointRef.current = null;
            }

            currentStrokeRef.current.push({ x, y });

            if (previousPointRef.current) {
              drawCtx.beginPath();
              drawCtx.moveTo(previousPointRef.current.x, previousPointRef.current.y);
              drawCtx.lineTo(x, y);
              drawCtx.strokeStyle = '#00ffcc';
              drawCtx.lineWidth = 6;
              drawCtx.lineCap = 'round';
              drawCtx.stroke();
            }
            previousPointRef.current = { x, y };

            cameraCtx.beginPath();
            cameraCtx.arc(x, y, 8, 0, 2 * Math.PI);
            cameraCtx.fillStyle = '#00ffcc';
            cameraCtx.fill();
          } else {
            previousPointRef.current = null;
            if (isDrawingRef.current) {
              releaseFrameCountRef.current += 1;
              const RELEASE_CONFIRM_FRAMES = 3;
              if (releaseFrameCountRef.current >= RELEASE_CONFIRM_FRAMES) {
                scheduleFinishEvaluation();
              }
            }
          }
        } else {
          previousPointRef.current = null;
          if (isDrawingRef.current) {
            lostFrameCountRef.current += 1;
            const LOST_CONFIRM_FRAMES = 6;
            if (lostFrameCountRef.current >= LOST_CONFIRM_FRAMES) {
              scheduleFinishEvaluation();
            }
          }
        }
        return;
      }

      if (currentTask.id === 'clap') {
        if (landmarksList && landmarksList.length >= 2) {
          const h1Wrist = landmarksList[0][0];
          const h2Wrist = landmarksList[1][0];
          if (Math.hypot(h1Wrist.x - h2Wrist.x, h1Wrist.y - h2Wrist.y) < 0.25) {
            handleStepSuccess();
          }
        }
      }
      else if (currentTask.id === 'fist') {
        if (landmarksList && landmarksList.length > 0) {
          const hand = landmarksList[0];
          const isFist =
            hand[8].y > hand[6].y &&
            hand[12].y > hand[10].y &&
            hand[16].y > hand[14].y &&
            hand[20].y > hand[18].y;

          if (isFist) {
            handleStepSuccess();
          }
        }
      }
      else if (currentTask.id === 'three') {
        if (landmarksList && landmarksList.length > 0) {
          const hand = landmarksList[0];
          const isIndexOpen = hand[8].y < hand[6].y;
          const isMiddleOpen = hand[12].y < hand[10].y;
          const isRingOpen = hand[16].y < hand[14].y;
          const isPinkyClosed = hand[20].y > hand[18].y;

          const isThree = isIndexOpen && isMiddleOpen && isRingOpen && isPinkyClosed;

          if (isThree) {
            handleStepSuccess();
          }
        }
      }
    });

    const camera = new Camera(videoElement, {
      onFrame: async () => {
        if (videoElement && handsRef.current && phaseRef.current === 'running') {
          try {
            await handsRef.current.send({ image: videoElement });
          } catch (err) {
            console.log("Frame işleme hatası:", err);
          }
        }
      },
      width: 640,
      height: 480
    });
    cameraRef.current = camera;
    camera.start();

    return () => {
      if (cameraRef.current) cameraRef.current.stop();
      if (handsRef.current) handsRef.current.close();
      if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [handleStepSuccess]);

  const handleClearCanvas = () => {
    const drawCanvas = drawCanvasRef.current;
    if (drawCanvas) {
      drawCanvas.getContext('2d').clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      currentStrokeRef.current = [];
    }
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
    isDrawingRef.current = false;
    previousPointRef.current = null;
    releaseFrameCountRef.current = 0;
    lostFrameCountRef.current = 0;
    setBorderRed(false);
  };

  const currentTask = selectedTasks[currentStep];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', backgroundColor: '#121212', color: '#fff', fontFamily: 'sans-serif', padding: '20px'
    }}>
      <h2>MÜLAKAT DOĞRULAMA SİSTEMİ</h2>

      {phase === 'idle' && (
        <button onClick={startTest} style={{
          padding: '14px 32px', fontSize: '16px', fontWeight: 'bold', color: '#121212',
          backgroundColor: '#00ffcc', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '16px'
        }}>
          Testi Başlat
        </button>
      )}

      {phase === 'verified' && (
        <div style={{
          backgroundColor: '#0d3320', border: '1px solid #00ffcc', color: '#00ffcc',
          padding: '16px 28px', borderRadius: '12px', marginBottom: '16px', fontWeight: 'bold', textAlign: 'center', maxWidth: 500
        }}>
          {feedback}
          <br /><br />
          <button onClick={startTest} style={{
            padding: '10px 24px', backgroundColor: '#00ffcc', color: '#121212', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold'
          }}>
            Yeniden Başlat
          </button>
        </div>
      )}

      {phase === 'fail' && (
        <div style={{
          backgroundColor: '#330d0d', border: '1px solid #ff0055', color: '#ff0055',
          padding: '16px 28px', borderRadius: '12px', marginBottom: '16px', fontWeight: 'bold', textAlign: 'center'
        }}>
          {feedback}
          <br /><br />
          <button onClick={startTest} style={{
            padding: '8px 20px', backgroundColor: '#ff0055', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer'
          }}>
            Tekrar Dene
          </button>
        </div>
      )}

      {phase === 'running' && currentTask && (
        <div style={{
          backgroundColor: '#222', padding: '14px 24px', borderRadius: '12px',
          border: `1px solid ${timeLeft <= 3 ? '#ff0055' : '#00ffcc'}`, marginBottom: '10px', textAlign: 'center', maxWidth: 500
        }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#00ffcc' }}>
            Görev {currentStep + 1}/{REQUIRED_STEPS}: {currentTask.title}
          </div>
          <div style={{ fontSize: '14px', color: '#ccc', marginTop: '4px' }}>
            {currentTask.desc}
          </div>
          <div style={{ color: timeLeft <= 3 ? '#ff0055' : '#aaa', fontWeight: 'bold', marginTop: '8px' }}>
            ⏱️ Kalan Süre: {timeLeft} sn
          </div>
          {feedback && <div style={{ marginTop: '6px', fontSize: '14px', color: '#ffbb00' }}>{feedback}</div>}
        </div>
      )}

      <div style={{ position: 'relative', width: 640, height: 480 }}>
        <video ref={videoRef} style={{ display: 'none' }} />
        <canvas ref={cameraCanvasRef} width={640} height={480} style={{
          position: 'absolute', top: 0, left: 0, borderRadius: '12px',
          border: `3px solid ${borderRed ? '#ff0055' : '#00ffcc'}`
        }} />
        <canvas ref={drawCanvasRef} width={640} height={480} style={{
          position: 'absolute', top: 0, left: 0, borderRadius: '12px', pointerEvents: 'none'
        }} />
      </div>

      {currentTask && currentTask.id === 'triangle' && phase === 'running' && (
        <button onClick={handleClearCanvas} style={{
          marginTop: '15px', padding: '8px 20px', fontSize: '14px', fontWeight: 'bold',
          color: '#fff', backgroundColor: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer'
        }}>
          
          Çizimi Temizle
          
        </button>
      )}
    </div>
  );
}

export default App;