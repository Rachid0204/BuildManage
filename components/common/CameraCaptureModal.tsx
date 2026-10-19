import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, RefreshCw, Check, X, Upload, AlertCircle } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { useI18n } from '../../hooks/useI18n';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}

export const compressImageFile = (
  file: File,
  maxWidth = 1100,
  maxHeight = 1100,
  quality = 0.82
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const { tr } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopStream();
      setCameraError(null);
      setIsStarting(true);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          tr(
            "L'accès direct à la caméra n'est pas supporté sur ce navigateur. Utilisez le bouton ci-dessous pour prendre une photo avec votre appareil.",
            'الولوج المباشر إلى الكاميرا غير مدعوم في هذا المتصفح. استخدم الزر أدناه لالتقاط صورة بجهازك.'
          )
        );
        setIsStarting(false);
        return;
      }

      try {
        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        } catch {
          // Fallback to any available video camera
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        setCameraError(
          tr(
            "Impossible d'accéder à la caméra (autorisation refusée ou caméra indisponible). Vous pouvez prendre ou sélectionner une photo via votre appareil ci-dessous.",
            'تعذر الوصول إلى الكاميرا (تم رفض الإذن أو الكاميرا غير متوفرة). يمكنك التقاط أو اختيار صورة من جهازك أدناه.'
          )
        );
      } finally {
        setIsStarting(false);
      }
    },
    [stopStream, tr]
  );

  useEffect(() => {
    if (isOpen && !capturedImage) {
      startCamera(facingMode);
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, capturedImage, startCamera, stopStream]);

  const handleClose = () => {
    stopStream();
    setCapturedImage(null);
    setCameraError(null);
    onClose();
  };

  const handleTakeSnapshot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const maxWidth = 1100;
    const maxHeight = 1100;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > maxWidth || height > maxHeight) {
      if (width / height > maxWidth / maxHeight) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      } else {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    stopStream();
    setCapturedImage(dataUrl);
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };

  const handleConfirmPhoto = () => {
    if (!capturedImage) return;
    onCapture(capturedImage);
    handleClose();
  };

  const handleToggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleNativeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      onCapture(compressed);
      handleClose();
    } catch {
      // ignore error
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={tr("Prendre une photo de l'incident", 'التقاط صورة للعطب')}
      maxWidthClass="sm:max-w-xl"
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {tr('Annuler', 'إلغاء')}
          </Button>
          {capturedImage ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={handleRetake}
                className="flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                <span>{tr('Reprendre', 'إعادة الالتقاط')}</span>
              </Button>
              <Button
                onClick={handleConfirmPhoto}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{tr('Joindre cette photo', 'إرفاق هذه الصورة')}</span>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {!cameraError && (
                <>
                  <button
                    type="button"
                    onClick={handleToggleFacingMode}
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
                    title={tr('Changer de caméra (Avant / Arrière)', 'تبديل الكاميرا (أمامية / خلفية)')}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{tr('Inverser caméra', 'تبديل الكاميرا')}</span>
                  </button>
                  <Button
                    onClick={handleTakeSnapshot}
                    disabled={isStarting}
                    className="bg-teal-700 hover:bg-teal-800 text-white font-bold flex items-center gap-1.5"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{tr('Capturer', 'التقاط')}</span>
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <input
          ref={nativeCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleNativeFileChange}
        />

        {capturedImage ? (
          <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-300 flex items-center justify-center max-h-[60vh]">
            <img
              src={capturedImage}
              alt={tr('Aperçu capture', 'معاينة الصورة الملتقطة')}
              className="max-w-full max-h-[55vh] object-contain"
            />
            <span className="absolute top-3 start-3 bg-emerald-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-xs">
              ✓ {tr('Photo capturée', 'تم التقاط الصورة')}
            </span>
          </div>
        ) : cameraError ? (
          <div className="p-6 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <p className="text-xs text-amber-900 leading-relaxed max-w-md mx-auto">{cameraError}</p>
            <div>
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span>
                  {tr(
                    "Ouvrir l'appareil photo / Choisir une image",
                    'فتح الكاميرا / اختيار صورة من الجهاز'
                  )}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {isStarting && (
              <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center text-white text-xs gap-2">
                <div className="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                <span>{tr('Activation de la caméra...', 'جاري تشغيل الكاميرا...')}</span>
              </div>
            )}

            {/* Viewfinder framing guides */}
            <div className="pointer-events-none absolute inset-4 border border-white/25 rounded-lg" />

            {/* Floating shutter button at bottom center of video */}
            {!isStarting && (
              <div className="absolute bottom-3 inset-x-0 flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleTakeSnapshot}
                  aria-label={tr('Prendre la photo', 'التقاط الصورة')}
                  className="w-14 h-14 rounded-full bg-white/90 hover:bg-white p-1 shadow-lg transition-transform active:scale-95 flex items-center justify-center"
                >
                  <span className="w-11 h-11 rounded-full border-2 border-teal-700 bg-teal-600 hover:bg-teal-700 flex items-center justify-center text-white">
                    <Camera className="w-5 h-5" />
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Secondary fallback bar for mobile native camera or file upload */}
        {!capturedImage && !cameraError && (
          <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 text-[11px] text-slate-600">
            <span>
              {tr(
                'Cadrez la panne ou fuite puis cliquez sur Capturer.',
                'وجّه الكاميرا نحو العطب ثم اضغط على التقاط.'
              )}
            </span>
            <button
              type="button"
              onClick={() => nativeCameraInputRef.current?.click()}
              className="text-teal-700 hover:text-teal-900 font-bold underline flex items-center gap-1 shrink-0 ms-2"
            >
              <Upload className="w-3 h-3" />
              <span>{tr('Appareil natif / Fichier', 'كاميرا الهاتف / ملف')}</span>
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CameraCaptureModal;
