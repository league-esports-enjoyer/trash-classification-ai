/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Upload, Trash2, Leaf, Recycle, Info, Loader2, RefreshCcw, ChevronRight, ChevronLeft, AlertCircle, Plus, Image as ImageIcon, Download, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { analyzeWaste } from './lib/gemini';
import { cn } from './lib/utils';
import { preprocessImage } from './lib/imageProcessor';

interface WasteAnalysis {
  id: string;
  image: string;
  processedImage: string | null;
  result: string | null;
  category: string | null;
  groundTruth: string | null;
  isAnalyzing: boolean;
  isPreprocessing: boolean;
  error: string | null;
}

const WASTE_CATEGORIES = [
  { id: 'RECYCLABLE', vi: 'Tái chế', en: 'Recyclable', color: 'bg-green-500' },
  { id: 'ORGANIC', vi: 'Hữu cơ', en: 'Organic', color: 'bg-orange-500' },
  { id: 'NON_RECYCLABLE', vi: 'Vô cơ còn lại', en: 'Non-recyclable', color: 'bg-gray-500' },
  { id: 'HAZARDOUS', vi: 'Nguy hại', en: 'Hazardous', color: 'bg-red-500' },
  { id: 'MIXED', vi: 'Hỗn hợp', en: 'Mixed', color: 'bg-amber-500' },
];

const extractCategory = (markdown: string): string | null => {
  const match = markdown.match(/\[CATEGORY_TAG:\s*(RECYCLABLE|ORGANIC|NON_RECYCLABLE|HAZARDOUS|MIXED)\]/);
  return match ? match[1] : null;
};

const ProgressBar = ({ className, color = "bg-white" }: { className?: string; color?: string }) => (
  <div className={cn("relative w-full h-1 overflow-hidden rounded-full bg-black/10", className)}>
    <motion.div
      className={cn("absolute inset-y-0 left-0 w-1/2 rounded-full", color)}
      animate={{
        x: ["-100%", "200%"],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: "linear",
      }}
    />
  </div>
);

export default function App() {
  const [lang, setLang] = useState<'vi' | 'en'>('vi');
  const [analyses, setAnalyses] = useState<WasteAnalysis[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trainingConfig, setTrainingConfig] = useState({
    learningRate: 0.001,
    epochs: 10,
    augmentation: true,
    dataSize: 5000
  });
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isJumping, setIsJumping] = useState(false);
  const [jumpPage, setJumpPage] = useState("");
  const [isTraining, setIsTraining] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const addImages = async (newImages: string[]) => {
    const tempIds: string[] = [];
    
    // Initial state with original images
    const initialAnalyses: WasteAnalysis[] = newImages.map(img => {
      const id = Math.random().toString(36).substr(2, 9);
      tempIds.push(id);
      return {
        id,
        image: img,
        processedImage: null,
        result: null,
        category: null,
        groundTruth: null,
        isAnalyzing: false,
        isPreprocessing: true,
        error: null
      };
    });
    
    setAnalyses(prev => {
      const updated = [...prev, ...initialAnalyses];
      if (activeIndex === -1) setActiveIndex(prev.length);
      return updated;
    });

    // Start preprocessing after state update
    for (const item of initialAnalyses) {
      try {
        const processed = await preprocessImage(item.image);
        setAnalyses(prev => prev.map(a => 
          a.id === item.id ? { ...a, processedImage: processed, isPreprocessing: false } : a
        ));
      } catch (err) {
        setAnalyses(prev => prev.map(a => 
          a.id === item.id ? { ...a, isPreprocessing: false, error: t.errorPreprocess } : a
        ));
      }
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const fileList = Array.from(files);
      const readPromises = fileList.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });
      
      Promise.all(readPromises).then(images => {
        addImages(images);
      });
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startCamera = async () => {
    try {
      setIsCameraOpen(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        addImages([dataUrl]);
        stopCamera();
      }
    }
  };

  const handleAnalyze = async (index: number) => {
    const item = analyses[index];
    if (!item || item.isAnalyzing || item.result || item.isPreprocessing) return;
    
    setAnalyses(prev => prev.map((a, i) => i === index ? { ...a, isAnalyzing: true, error: null } : a));

    try {
      const imageToAnalyze = item.processedImage || item.image;
      const mimeType = imageToAnalyze.split(';')[0].split(':')[1];
      const analysis = await analyzeWaste(imageToAnalyze, mimeType, lang);
      const category = extractCategory(analysis);
      setAnalyses(prev => prev.map((a, i) => i === index ? { 
        ...a, 
        result: analysis || (lang === 'en' ? "Unable to analyze data." : "Không thể phân tích dữ liệu."), 
        category: category,
        isAnalyzing: false 
      } : a));
    } catch (err: any) {
      console.error("Analysis error:", err);
      let errorMsg = t.errorDefault;
      
      const errString = typeof err === 'string' ? err : JSON.stringify(err);
      if (errString.includes("credits are depleted") || errString.includes("prepayment")) {
        errorMsg = t.errorCredits;
      } else if (errString.includes("RESOURCE_EXHAUSTED") || errString.includes("429")) {
        errorMsg = t.errorQuota;
      }
      
      setAnalyses(prev => prev.map((a, i) => i === index ? { ...a, error: errorMsg, isAnalyzing: false } : a));
    }
  };

  const handleAnalyzeSelected = async () => {
    const toAnalyze = analyses
      .filter(item => selectedIds.has(item.id) && !item.result && !item.isAnalyzing)
      .map(item => analyses.indexOf(item));
    
    if (toAnalyze.length === 0) return;

    // Clear selection after triggering
    setSelectedIds(new Set());

    // Run analyses in parallel
    await Promise.all(toAnalyze.map(idx => handleAnalyze(idx)));
  };

  const handleAnalyzeAll = async () => {
    const toAnalyze = analyses
      .map((item, idx) => (!item.result && !item.isAnalyzing ? idx : -1))
      .filter(idx => idx !== -1);
    
    if (toAnalyze.length === 0) return;

    // Run analyses in parallel
    await Promise.all(toAnalyze.map(idx => handleAnalyze(idx)));
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === analyses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(analyses.map(a => a.id)));
    }
  };

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const removeAnalysis = (index: number) => {
    setAnalyses(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length === 0) {
        setActiveIndex(-1);
      } else if (activeIndex >= updated.length) {
        setActiveIndex(updated.length - 1);
      }
      return updated;
    });
  };

  const clearAllAnalyses = () => {
    if (analyses.length === 0) return;
    setAnalyses([]);
    setActiveIndex(-1);
  };

  const setGroundTruth = (index: number, category: string | null) => {
    setAnalyses(prev => prev.map((a, i) => i === index ? { ...a, groundTruth: category } : a));
  };

  const activeItem = activeIndex !== -1 ? analyses[activeIndex] : null;

  const t = {
    vi: {
      title: "EcoSort AI",
      subtitle: "Chuyên gia Rác thải Thông minh",
      headerBadge: "Hệ thống Phân loại Thông minh",
      yourImages: "Ảnh của bạn",
      analyzeAll: "Phân tích tất cả",
      analyzeSelected: "Phân tích đã chọn",
      selectAll: "Chọn hết",
      deselectAll: "Bỏ chọn",
      deleteAll: "Xóa hết",
      noImages: "Chưa có ảnh nào. Hãy nhấn \"+\" để thêm.",
      preprocessing: "Đang tiền xử lý...",
      downloadOriginal: "Tải ảnh gốc",
      analyzeThis: "Phân tích ảnh này",
      analyzing: "Đang phân tích...",
      analysisDone: "Đã phân tích xong",
      uploadTitle: "Tải ảnh rác thải",
      uploadDesc: "Nhấn để chọn một hoặc nhiều ảnh, hoặc dùng camera để chụp.",
      detailedResult: "Kết quả chi tiết",
      jumpPrompt: "Nhấn để nhảy tới trang",
      readyToAnalyze: "Sẵn sàng phân tích",
      readyToAnalyzeDesc: "Chọn một ảnh và nhấn \"Phân tích rác thải\" để xem kết quả chi tiết từ chuyên gia AI.",
      thankYou: "Cảm ơn bạn đã bảo vệ môi trường!",
      downloadAll: "Tải tất cả",
      downloadMd: "Tải về (.md)",
      tipTitle: "Lời khuyên bền vững:",
      tipContent: "Hãy thử mang theo hộp cơm cá nhân khi đi mua đồ ăn sẵn để cắt giảm hoàn toàn lượng nhựa PET và túi nilon dùng một lần mỗi ngày.",
      copyright: "© 2026 EcoSort AI - Vì một tương lai xanh",
      errorDefault: "Đã xảy ra lỗi trong quá trình phân tích. Vui lòng thử lại.",
      errorQuota: "Hệ thống đang quá tải (vượt quá giới hạn quota). Vui lòng đợi vài giây và thử lại.",
      errorCredits: "Số dư tài khoản (credits) của bạn đã hết. Vui lòng kiểm tra lại thiết lập thanh toán tại AI Studio.",
      errorPreprocess: "Lỗi xử lý ảnh.",
      workflowTitle: "Quy trình Hệ thống",
      step1Title: "Tiền xử lý",
      step1Desc: "Làm nét & Tăng tương phản",
      step2Title: "Nén & Tối ưu",
      step2Desc: "Resize 1200px & Nén JPEG",
      step3Title: "AI Inference",
      step3Desc: "Gemini-1.5-Flash Model",
      step4Title: "Kết quả",
      step4Desc: "Phân loại & Giải pháp",
      evaluationTitle: "Triển khai & Đánh giá",
      evalTestTitle: "Kiểm thử",
      evalTestDesc: "Dữ liệu thực tế mới",
      evalMetricsTitle: "Đánh giá",
      evalMetricsDesc: "Độ chính xác AI",
      evalCritiqueTitle: "Phản biện",
      evalCritiqueDesc: "Tối ưu & Khắc phục",
      verifyPrompt: "Xác minh kết quả của AI:",
      correct: "Đúng",
      incorrect: "Sai",
      metricsDashboard: "Bảng Chỉ số Hiệu năng (Real-time Metrics)",
      accuracy: "Độ chính xác (Accuracy)",
      precision: "Độ chính xác (Precision)",
      recall: "Độ phủ (Recall)",
      totalVerified: "Tổng số verified",
      categoryHeader: "Hạng mục",
      groundTruthPrompt: "Hãy chọn phân loại đúng:",
      modelOptTitle: "Tối ưu hóa Mô hình (Optimization)",
      learningRate: "Learning Rate",
      epochs: "Số Epochs",
      augmentation: "Data Augmentation",
      dataSize: "Quy mô dữ liệu",
      retrain: "Tái huấn luyện",
      trainingStatus: "Đang cập nhật trọng số...",
      ambiguousInfo: "Xử lý rác dễ nhầm (nhựa bẩn, giấy ướt, hộp sữa...)"
    },
    en: {
      title: "EcoSort AI",
      subtitle: "Smart Waste Expert",
      headerBadge: "Smart Classification System",
      yourImages: "Your Images",
      analyzeAll: "Analyze All",
      analyzeSelected: "Analyze Selected",
      selectAll: "Select All",
      deselectAll: "Deselect All",
      deleteAll: "Delete All",
      noImages: "No images yet. Click \"+\" to add.",
      preprocessing: "Preprocessing...",
      downloadOriginal: "Download Original",
      analyzeThis: "Analyze image",
      analyzing: "Analyzing...",
      analysisDone: "Analysis Complete",
      uploadTitle: "Upload Waste Photo",
      uploadDesc: "Click to select one or more images, or use camera.",
      detailedResult: "Detailed Results",
      jumpPrompt: "Click to jump to page",
      readyToAnalyze: "Ready to Analyze",
      readyToAnalyzeDesc: "Select an image and click \"Analyze Waste\" to see detailed results from our AI expert.",
      thankYou: "Thank you for protecting our planet!",
      downloadAll: "Download All",
      downloadMd: "Download (.md)",
      tipTitle: "Sustainability Tip:",
      tipContent: "Try bringing your own lunch box when buying takeout to completely cut down on single-use PET plastic and plastic bags daily.",
      copyright: "© 2026 EcoSort AI - For a greener future",
      errorDefault: "An error occurred during analysis. Please try again.",
      errorQuota: "System is overloaded (quota limit exceeded). Please wait a few seconds and try again.",
      errorCredits: "Your prepayment credits are depleted. Please check your project billing at AI Studio.",
      errorPreprocess: "Image processing error.",
      workflowTitle: "Technical Workflow",
      step1Title: "Preprocessing",
      step1Desc: "Sharpening & Contrast",
      step2Title: "Compression",
      step2Desc: "Smart Resize & JPEG",
      step3Title: "AI Inference",
      step3Desc: "Gemini-1.5-Flash Hub",
      step4Title: "Output",
      step4Desc: "Classify & Solve",
      evaluationTitle: "Deployment & Evaluation",
      evalTestTitle: "New Data Test",
      evalTestDesc: "Real-world validation",
      evalMetricsTitle: "Evaluation",
      evalMetricsDesc: "System accuracy",
      evalCritiqueTitle: "Critique",
      evalCritiqueDesc: "Optimization loop",
      verifyPrompt: "Verify AI classification:",
      correct: "Correct",
      incorrect: "Incorrect",
      metricsDashboard: "Real-time Metrics Dashboard",
      accuracy: "Overall Accuracy",
      precision: "Precision",
      recall: "Recall",
      totalVerified: "Total Verified",
      categoryHeader: "Category",
      groundTruthPrompt: "Select correct category:",
      modelOptTitle: "Model Optimization",
      learningRate: "Learning Rate",
      epochs: "Epochs",
      augmentation: "Data Augmentation",
      dataSize: "Dataset Size",
      retrain: "Apply Optimization",
      trainingStatus: "Updating weights...",
      ambiguousInfo: "Handling ambiguous waste (dirty plastic, wet paper...)"
    }
  }[lang];

  return (
    <div className="min-h-screen bg-natural-bg text-natural-text font-sans selection:bg-natural-sage/20 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-natural-border px-10 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-natural-primary p-2 rounded-lg shadow-md">
              <Leaf className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-natural-primary">{t.title}</h1>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-natural-sage">{t.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-natural-bg rounded-lg p-1 border border-natural-border">
              <button 
                onClick={() => setLang('vi')}
                className={cn(
                  "px-3 py-1 rounded-md text-[11px] font-bold transition-all",
                  lang === 'vi' ? "bg-natural-primary text-white shadow-sm" : "text-natural-muted hover:text-natural-primary"
                )}
              >
                VI
              </button>
              <button 
                onClick={() => setLang('en')}
                className={cn(
                  "px-3 py-1 rounded-md text-[11px] font-bold transition-all",
                  lang === 'en' ? "bg-natural-primary text-white shadow-sm" : "text-natural-muted hover:text-natural-primary"
                )}
              >
                EN
              </button>
            </div>
            <Badge className="bg-natural-sage text-white border-none px-4 py-1.5 rounded-full text-[13px] font-semibold tracking-wide uppercase hidden sm:flex">
              {t.headerBadge}
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto flex-1 grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-8 px-10 py-8 w-full">
        {/* Left Column: Image Pool & Selection */}
        <div className="space-y-6 flex flex-col h-full">
          <section className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-natural-muted" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-natural-muted">{t.yourImages} ({analyses.length})</h2>
              </div>
              <div className="flex gap-1 items-center">
                {analyses.length > 0 && (
                  <Button 
                    size="sm" 
                    variant="link" 
                    className="h-8 px-2 text-[11px] text-natural-muted hover:text-natural-primary font-bold uppercase tracking-tighter"
                    onClick={toggleSelectAll}
                  >
                    {selectedIds.size === analyses.length ? t.deselectAll : t.selectAll}
                  </Button>
                )}
                {analyses.length > 0 && (
                  <Button 
                    size="sm" 
                    variant="link" 
                    className="h-8 px-2 text-[11px] text-red-500 hover:text-red-600 font-bold uppercase tracking-tighter"
                    onClick={clearAllAnalyses}
                  >
                    {t.deleteAll}
                  </Button>
                )}
                {selectedIds.size > 0 ? (
                  <Button 
                    size="sm" 
                    variant="link" 
                    className="h-8 px-2 text-[11px] text-natural-primary font-bold uppercase tracking-tighter bg-natural-primary/5 rounded-md"
                    onClick={handleAnalyzeSelected}
                  >
                    {t.analyzeSelected} ({selectedIds.size})
                  </Button>
                ) : analyses.some(a => !a.result && !a.isAnalyzing) && (
                  <Button 
                    size="sm" 
                    variant="link" 
                    className="h-8 px-2 text-[11px] text-natural-primary font-bold uppercase tracking-tighter"
                    onClick={handleAnalyzeAll}
                  >
                    {t.analyzeAll}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-full text-natural-primary" onClick={() => fileInputRef.current?.click()}>
                  <Plus className="w-4 h-4" />
                </Button>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-full text-natural-primary" onClick={startCamera}>
                  <Camera className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Thumbnail Scroll */}
            <ScrollArea className="w-full whitespace-nowrap rounded-xl border border-natural-border bg-white p-2">
              <div className="flex gap-2">
                {analyses.length === 0 && !isCameraOpen && (
                  <div className="flex items-center justify-center h-16 w-full text-xs text-natural-muted italic">
                    {t.noImages}
                  </div>
                )}
                {analyses.map((item, idx) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveIndex(idx)}
                    className={cn(
                      "relative h-16 w-16 rounded-lg overflow-hidden border-2 transition-all shrink-0",
                      activeIndex === idx ? "border-natural-primary scale-105" : "border-transparent opacity-60 grayscale hover:grayscale-0 hover:opacity-100",
                      selectedIds.has(item.id) && "ring-2 ring-offset-1 ring-natural-primary"
                    )}
                  >
                    <img src={item.processedImage || item.image} alt={`Thumb ${idx}`} className={cn("h-full w-full object-cover", item.isPreprocessing && "blur-[2px]")} />
                    
                    {/* Selection Toggle Area */}
                    <div 
                      className={cn(
                        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full border border-white/50 flex items-center justify-center transition-all",
                        selectedIds.has(item.id) ? "bg-natural-primary scale-110" : "bg-black/20 hover:bg-black/40"
                      )}
                      onClick={(e) => toggleSelection(item.id, e)}
                    >
                      {selectedIds.has(item.id) && <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />}
                    </div>

                    {/* Analyzed Status Tick */}
                    {item.result && (
                      <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-green-500 border border-white/50 flex items-center justify-center shadow-sm z-10">
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />
                      </div>
                    )}

                    {(item.isAnalyzing || item.isPreprocessing) && (
                      <div className="absolute inset-x-0 bottom-0 p-1 bg-black/20 flex flex-col gap-1 items-center justify-center">
                        <ProgressBar color="bg-natural-primary" className="h-1" />
                        <span className="text-[7px] text-white font-bold uppercase tracking-tighter">
                          {item.isPreprocessing ? "PRE" : "AI"}
                        </span>
                      </div>
                    )}
                    {item.result && !item.isAnalyzing && (
                      <div className="absolute bottom-0 right-0 p-0.5 bg-natural-primary">
                        <Recycle className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
            
            <AnimatePresence mode="wait">
              {isCameraOpen ? (
                <motion.div
                  key="camera-view"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="relative rounded-[24px] overflow-hidden bg-black aspect-[3/4] shadow-2xl border-2 border-dashed border-natural-border"
                >
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 px-4">
                    <Button variant="destructive" size="icon" className="rounded-full w-12 h-12" onClick={stopCamera}>
                      <RefreshCcw className="w-6 h-6" />
                    </Button>
                    <Button className="rounded-full w-16 h-16 bg-white hover:bg-gray-100 text-black border-4 border-natural-primary" onClick={capturePhoto}>
                      <div className="w-10 h-10 rounded-full bg-natural-primary" />
                    </Button>
                  </div>
                </motion.div>
              ) : activeItem ? (
                <motion.div
                  key={activeItem.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative rounded-[24px] overflow-hidden shadow-lg border-2 border-dashed border-natural-border bg-white"
                >
                  <div className="bg-[#F0EEE4] flex items-center justify-center aspect-[3/4] relative overflow-hidden">
                    <img src={activeItem.processedImage || activeItem.image} alt="Waste preview" className={cn("w-full h-full object-cover transition-all duration-700", activeItem.isPreprocessing && "scale-110 blur-md grayscale brightness-50")} />
                    {activeItem.isPreprocessing && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/10 backdrop-blur-[2px] z-10">
                        <div className="w-48 space-y-3">
                          <ProgressBar color="bg-white" className="h-1.5 shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                          <div className="text-center">
                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] animate-pulse drop-shadow-md">
                              {t.preprocessing}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="absolute top-4 right-4 flex gap-2">
                    <Button 
                      variant="secondary" 
                      size="icon" 
                      className="rounded-full shadow-lg h-8 w-8 bg-white/90 hover:bg-white"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = activeItem.image;
                        link.download = `eco-original-${activeIndex + 1}.jpg`;
                        link.click();
                      }}
                      title={t.downloadOriginal}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="destructive" size="icon" className="rounded-full shadow-lg h-8 w-8" onClick={() => removeAnalysis(activeIndex)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  
                  {!activeItem.result && (
                    <div className="p-4 bg-white border-t border-natural-border">
                      <Button 
                        className="w-full bg-natural-primary hover:bg-natural-primary/90 text-white font-bold py-6 rounded-xl shadow-lg"
                        onClick={() => handleAnalyze(activeIndex)}
                        disabled={activeItem.isAnalyzing}
                      >
                        {activeItem.isAnalyzing ? (
                          <div className="flex flex-col items-center gap-2 w-full">
                            <ProgressBar color="bg-white" className="h-1 bg-white/20" />
                            <span className="text-xs">{t.analyzing}</span>
                          </div>
                        ) : (
                          <>
                            <Recycle className="w-5 h-5 mr-2" />
                            {t.analyzeThis}
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                  {activeItem.result && (
                    <div className="p-3 bg-natural-primary/10 text-natural-primary text-center text-xs font-semibold uppercase tracking-wider">
                      {t.analysisDone}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="upload-prompt"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-20 text-center space-y-4 border-2 border-dashed border-natural-border rounded-[24px] bg-white group hover:bg-natural-bg transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-16 h-16 bg-natural-bg rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-natural-muted" />
                  </div>
                  <div className="space-y-1 px-8">
                    <p className="text-lg font-semibold text-natural-text">{t.uploadTitle}</p>
                    <p className="text-sm text-natural-muted">{t.uploadDesc}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {activeItem?.error && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 font-medium text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              {activeItem.error}
            </motion.div>
          )}
        </div>

        {/* Right Column: Results */}
        <div className="space-y-6 flex flex-col h-full">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Recycle className="w-4 h-4 text-natural-muted" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-natural-muted">
                {t.detailedResult} {activeIndex !== -1 ? `#${activeIndex + 1}` : ""}
              </h2>
            </div>
            
            {analyses.length > 1 && (
              <div className="flex items-center gap-1 bg-white border border-natural-border rounded-full px-1 py-0.5">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-7 w-7 rounded-full text-natural-muted hover:text-natural-primary disabled:opacity-30"
                  onClick={() => setActiveIndex(prev => Math.max(0, prev - 1))}
                  disabled={activeIndex <= 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {isJumping ? (
                  <input
                    type="number"
                    className="w-12 h-6 text-[10px] font-bold text-center border border-natural-primary rounded outline-none text-natural-primary bg-white"
                    value={jumpPage}
                    onChange={(e) => setJumpPage(e.target.value)}
                    onBlur={() => setIsJumping(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const page = parseInt(jumpPage);
                        if (!isNaN(page) && page >= 1 && page <= analyses.length) {
                          setActiveIndex(page - 1);
                        }
                        setIsJumping(false);
                      } else if (e.key === 'Escape') {
                        setIsJumping(false);
                      }
                    }}
                    autoFocus
                    min={1}
                    max={analyses.length}
                  />
                ) : (
                  <span 
                    className="text-[10px] font-bold text-natural-muted px-1 min-w-[3rem] text-center cursor-pointer hover:text-natural-primary transition-colors select-none"
                    onClick={() => {
                        setIsJumping(true);
                        setJumpPage((activeIndex + 1).toString());
                    }}
                    title={t.jumpPrompt}
                  >
                    {activeIndex + 1} / {analyses.length}
                  </span>
                )}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-7 w-7 rounded-full text-natural-muted hover:text-natural-primary disabled:opacity-30"
                  onClick={() => setActiveIndex(prev => Math.min(analyses.length - 1, prev + 1))}
                  disabled={activeIndex >= analyses.length - 1}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          
          <AnimatePresence mode="wait">
            {!activeItem?.result && !activeItem?.isAnalyzing ? (
              <motion.div 
                key="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center flex-1 py-12 text-center space-y-4 border border-natural-border rounded-[20px] bg-white shadow-sm"
              >
                <div className="w-16 h-16 bg-natural-bg rounded-full flex items-center justify-center">
                  <Info className="w-8 h-8 text-natural-border" />
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-natural-muted">{t.readyToAnalyze}</p>
                  <p className="text-sm text-natural-muted max-w-[280px]">{t.readyToAnalyzeDesc}</p>
                </div>
              </motion.div>
            ) : activeItem?.isAnalyzing ? (
              <motion.div key="loading-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 flex-1 flex flex-col">
                <div className="p-10 bg-white rounded-[20px] shadow-sm border border-natural-border flex-1 flex flex-col justify-center items-center gap-8">
                  <div className="w-full max-w-sm space-y-6">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <h3 className="text-sm font-bold text-natural-primary uppercase tracking-widest">{t.analyzing}</h3>
                        <p className="text-[10px] text-natural-muted uppercase">Gemini-1.5-Flash-Vision</p>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black text-natural-primary/20 italic">AI</span>
                      </div>
                    </div>
                    
                    <div className="relative">
                      <ProgressBar color="bg-natural-primary" className="h-3 shadow-inner" />
                      <div className="absolute -inset-1 blur-lg bg-natural-primary/5 -z-10 animate-pulse" />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-1 bg-natural-bg rounded-full overflow-hidden">
                          <motion.div 
                            className="h-full bg-natural-sage/30"
                            animate={{ opacity: [0.3, 0.7, 0.3] }}
                            transition={{ duration: 1, delay: i * 0.2, repeat: Infinity }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4 w-full max-w-md">
                    <div className="h-4 bg-natural-bg rounded-md animate-pulse w-full" />
                    <div className="h-4 bg-natural-bg rounded-md animate-pulse w-5/6" />
                    <div className="h-4 bg-natural-bg rounded-md animate-pulse w-4/6" />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={activeItem.id + "-result"}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white rounded-[20px] shadow-sm border border-natural-border overflow-hidden flex flex-col flex-1"
              >
                <ScrollArea className="flex-1 p-8">
                  <article className="prose prose-stone max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-p:text-natural-muted prose-li:text-natural-muted">
                    <ReactMarkdown
                      components={{
                        h1: ({node, ...props}) => <h1 className="text-2xl text-natural-primary mb-6 flex items-center gap-2" {...props} />,
                        h2: ({node, ...props}) => (
                          <h2 className="text-[14px] uppercase tracking-wider text-natural-muted mt-10 mb-6 flex items-center gap-2" {...props}>
                            <div className="w-1 h-4 bg-natural-earth rounded-full" />
                            {props.children}
                          </h2>
                        ),
                        h3: ({node, ...props}) => <h3 className="text-lg text-natural-text mt-8 mb-4 font-bold" {...props} />,
                        ul: ({node, ...props}) => <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6 list-none p-0" {...props} />,
                        li: ({node, ...props}) => (
                          <li className="bg-natural-bg/50 border border-natural-border p-4 rounded-xl text-sm leading-relaxed">
                            {props.children}
                          </li>
                        ),
                        p: ({node, ...props}) => {
                          const content = props.children?.toString() || "";
                          if (content.includes("Vô cơ") || content.includes("Hữu cơ") || content.includes("Inorganic") || content.includes("Organic")) {
                            return (
                              <div className="inline-block px-4 py-2 bg-[#E8F0E5] text-natural-primary rounded-full font-bold text-lg mb-4">
                                {content}
                              </div>
                            );
                          }
                          return <p className="leading-relaxed mb-4" {...props} />;
                        },
                        strong: ({node, ...props}) => <strong className="font-bold text-natural-primary block mb-1" {...props} />,
                      }}
                    >
                      {activeItem.result!}
                    </ReactMarkdown>

                    {/* Verification Section */}
                    {activeItem.category && (
                      <div className="mt-12 pt-8 border-t border-natural-border">
                        <div className="flex flex-col gap-4">
                          <h4 className="text-[11px] font-bold text-natural-muted uppercase tracking-[0.2em]">{t.verifyPrompt}</h4>
                          <div className="flex flex-wrap gap-2">
                            <Button 
                              size="sm"
                              variant={activeItem.groundTruth === activeItem.category ? "default" : "outline"}
                              className={cn(
                                "rounded-xl px-4 h-9 flex items-center gap-2 font-bold text-[11px] uppercase tracking-wider",
                                activeItem.groundTruth === activeItem.category ? "bg-green-600 hover:bg-green-700 text-white" : "border-green-100 hover:bg-green-50 text-green-700"
                              )}
                              onClick={() => setGroundTruth(activeIndex, activeItem.category)}
                            >
                              <Check className="w-3.5 h-3.5" />
                              {t.correct}
                            </Button>
                            
                            <Button
                              size="sm"
                              variant={activeItem.groundTruth && activeItem.groundTruth !== activeItem.category ? "default" : "outline"}
                              className={cn(
                                "rounded-xl px-4 h-9 flex items-center gap-2 font-bold text-[11px] uppercase tracking-wider transition-all",
                                activeItem.groundTruth && activeItem.groundTruth !== activeItem.category ? "bg-red-500 hover:bg-red-600 text-white" : "border-red-100 hover:bg-red-50 text-red-600"
                              )}
                              onClick={() => {
                                // Just a toggle to show options or reset
                                if (activeItem.groundTruth && activeItem.groundTruth !== activeItem.category) {
                                  setGroundTruth(activeIndex, null);
                                }
                              }}
                            >
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t.incorrect}
                            </Button>
                          </div>

                          {(activeItem.groundTruth === null || activeItem.groundTruth !== activeItem.category) && (
                            <div className="space-y-3 bg-natural-bg/50 p-4 rounded-2xl border border-natural-border/50">
                              <p className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.groundTruthPrompt}</p>
                              <div className="flex flex-wrap gap-2">
                                {WASTE_CATEGORIES.map(cat => (
                                  <Button
                                    key={cat.id}
                                    size="sm"
                                    variant={activeItem.groundTruth === cat.id ? "secondary" : "ghost"}
                                    className={cn(
                                      "h-8 px-3 text-[10px] uppercase font-bold rounded-lg border",
                                      activeItem.groundTruth === cat.id ? "bg-natural-primary text-white border-natural-primary" : "border-transparent hover:border-natural-border"
                                    )}
                                    onClick={() => setGroundTruth(activeIndex, cat.id)}
                                  >
                                    {lang === 'vi' ? cat.vi : cat.en}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                </ScrollArea>
                <div className="p-6 bg-natural-bg border-t border-natural-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Leaf className="w-5 h-5 text-natural-primary" />
                    <span className="text-sm font-semibold text-natural-primary">{t.thankYou}</span>
                  </div>
                  <div className="flex gap-2">
                    {analyses.filter(a => a.result).length > 1 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="text-natural-primary border-natural-primary/20 hover:bg-natural-sage/20 font-medium flex items-center gap-2"
                        onClick={() => {
                          const combined = analyses
                            .filter(a => a.result)
                            .map((a, i) => `## Photo #${i + 1}\n\n${a.result}`)
                            .join("\n\n---\n\n");
                          const blob = new Blob([combined], { type: 'text/markdown' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `eco-sort-full-analysis.md`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download className="w-4 h-4" />
                        {t.downloadAll}
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-natural-primary hover:bg-natural-sage/20 font-medium flex items-center gap-2"
                      onClick={() => {
                        const blob = new Blob([activeItem.result || ""], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `eco-sort-analysis-${activeIndex + 1}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="w-4 h-4" />
                      {t.downloadMd}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Model Optimization Dashboard */}
          <div className="mt-8 mb-4">
            <div className="flex items-center gap-2 mb-4 px-2">
              <RefreshCcw className="w-4 h-4 text-natural-muted" />
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-natural-muted/70">{t.modelOptTitle}</h2>
            </div>
            <div className="bg-white border border-natural-border p-6 rounded-[24px] shadow-sm flex flex-col lg:flex-row gap-8 items-start">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 flex-1 w-full">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.learningRate}</label>
                  <div className="text-sm font-mono text-natural-primary bg-natural-bg p-2 rounded-lg border border-natural-border/30">
                    {trainingConfig.learningRate}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.epochs}</label>
                  <div className="text-sm font-mono text-natural-primary bg-natural-bg p-2 rounded-lg border border-natural-border/30">
                    {trainingConfig.epochs}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.dataSize}</label>
                  <div className="text-sm font-mono text-natural-primary bg-natural-bg p-2 rounded-lg border border-natural-border/30">
                    {trainingConfig.dataSize.toLocaleString()}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.augmentation}</label>
                  <div className="text-sm font-mono text-natural-primary bg-natural-bg p-2 rounded-lg border border-natural-border/30">
                    {trainingConfig.augmentation ? "Enabled" : "Disabled"}
                  </div>
                </div>
              </div>
              <div className="w-full lg:w-48 space-y-4">
                <Button 
                  className="w-full h-12 rounded-xl bg-natural-primary hover:bg-natural-primary/90 text-white font-bold uppercase tracking-widest text-[11px]"
                  disabled={isTraining}
                  onClick={() => {
                    // Simulate training
                    setIsTraining(true);
                    setTimeout(() => setIsTraining(false), 2000);
                  }}
                >
                  {isTraining ? t.trainingStatus : t.retrain}
                </Button>
                <div className="p-3 bg-natural-sage/10 border border-natural-sage/20 rounded-xl">
                  <p className="text-[9px] text-natural-primary/80 leading-relaxed italic font-medium">
                    <Info className="w-3 h-3 inline mr-1 mb-0.5" />
                    {t.ambiguousInfo}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Technical Workflow Section */}
          <div className="mt-12 mb-4">
            <div className="flex items-center gap-2 mb-4 px-2">
              <RefreshCcw className="w-4 h-4 text-natural-muted" />
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-natural-muted/70">{t.workflowTitle}</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-2">
              {[
                { title: t.step1Title, desc: t.step1Desc, icon: "🔍" },
                { title: t.step2Title, desc: t.step2Desc, icon: "📦" },
                { title: t.step3Title, desc: t.step3Desc, icon: "🧠" },
                { title: t.step4Title, desc: t.step4Desc, icon: "✅" }
              ].map((step, i) => (
                <div key={i} className="bg-white/40 backdrop-blur-sm border border-natural-border/50 p-4 rounded-2xl flex flex-col items-center text-center hover:bg-white/60 transition-colors">
                  <span className="text-2xl mb-2">{step.icon}</span>
                  <h3 className="text-[11px] font-bold text-natural-primary uppercase tracking-tight">{step.title}</h3>
                  <p className="text-[10px] text-natural-muted leading-tight mt-1">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Deployment & Evaluation Section / Metrics Dashboard */}
          <div className="mt-8 mb-12">
            <div className="flex items-center justify-between mb-4 px-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-natural-muted" />
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-natural-muted/70">
                  {analyses.some(a => a.groundTruth) ? t.metricsDashboard : t.evaluationTitle}
                </h2>
              </div>
              {analyses.some(a => a.groundTruth) && (
                <div className="flex items-center gap-4 text-[10px] font-bold text-natural-muted uppercase tracking-widest">
                  <span>{t.totalVerified}: {analyses.filter(a => a.groundTruth).length}</span>
                </div>
              )}
            </div>

            {analyses.some(a => a.groundTruth) ? (
              <div className="space-y-4 px-2">
                {/* Overall Accuracy Card */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="col-span-1 md:col-span-1 bg-white border border-natural-border rounded-2xl p-6 flex flex-col justify-between shadow-sm">
                    <span className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.1em]">{t.accuracy}</span>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-4xl font-black text-natural-primary">
                        {(analyses.filter(a => a.category && a.groundTruth).length > 0
                          ? (analyses.filter(a => a.category === a.groundTruth).length / analyses.filter(a => a.category && a.groundTruth).length * 100).toFixed(1)
                          : "0.0")}%
                      </span>
                    </div>
                    <div className="mt-4 w-full bg-natural-bg h-1.5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(analyses.filter(a => a.category && a.groundTruth).length > 0 ? (analyses.filter(a => a.category === a.groundTruth).length / analyses.filter(a => a.category && a.groundTruth).length * 100) : 0)}%` }}
                        className="h-full bg-natural-primary"
                      />
                    </div>
                  </div>

                  <div className="col-span-1 md:col-span-3 bg-white border border-natural-border rounded-2xl p-6 shadow-sm overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-natural-border/50 text-[10px] font-bold text-natural-muted uppercase tracking-widest">
                          <th className="pb-3 font-bold">{t.categoryHeader}</th>
                          <th className="pb-3 text-center">{t.precision}</th>
                          <th className="pb-3 text-center">{t.recall}</th>
                          <th className="pb-3 text-right">TP/N</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs">
                        {WASTE_CATEGORIES.map(cat => {
                          const verified = analyses.filter(a => a.category && a.groundTruth);
                          const tp = verified.filter(a => a.category === cat.id && a.groundTruth === cat.id).length;
                          const fp = verified.filter(a => a.category === cat.id && a.groundTruth !== cat.id).length;
                          const fn = verified.filter(a => a.category !== cat.id && a.groundTruth === cat.id).length;
                          const n = verified.filter(a => a.groundTruth === cat.id).length;
                          
                          const precision = tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(0) : "0";
                          const recall = tp + fn > 0 ? (tp / (tp + fn) * 100).toFixed(0) : "0";

                          return (
                            <tr key={cat.id} className="border-b border-natural-border/20 last:border-0">
                              <td className="py-3 flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full", cat.color)} />
                                <span className="font-bold text-natural-primary">{lang === 'vi' ? cat.vi : cat.en}</span>
                              </td>
                              <td className="py-3 text-center">
                                <span className={cn("font-mono font-bold", parseInt(precision) > 85 ? "text-green-600" : "text-natural-muted")}>{precision}%</span>
                              </td>
                              <td className="py-3 text-center">
                                <span className={cn("font-mono font-bold", parseInt(recall) > 85 ? "text-green-600" : "text-natural-muted")}>{recall}%</span>
                              </td>
                              <td className="py-3 text-right font-mono text-natural-muted tabular-nums">
                                {tp}/{n}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-2">
                {[
                  { title: t.evalTestTitle, desc: t.evalTestDesc, icon: "🧪", color: "border-blue-100 bg-blue-50/30" },
                  { title: t.evalMetricsTitle, desc: t.evalMetricsDesc, icon: "📊", color: "border-green-100 bg-green-50/30" },
                  { title: t.evalCritiqueTitle, desc: t.evalCritiqueDesc, icon: "💬", color: "border-orange-100 bg-orange-50/30" }
                ].map((step, i) => (
                  <div key={i} className={cn("backdrop-blur-sm border p-4 rounded-2xl flex items-center gap-4 transition-all hover:scale-[1.02]", step.color)}>
                    <span className="text-2xl">{step.icon}</span>
                    <div>
                      <h3 className="text-xs font-bold text-natural-primary uppercase tracking-tight">{step.title}</h3>
                      <p className="text-[10px] text-natural-muted leading-tight mt-0.5">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer / Tip Section */}
      <footer className="bg-natural-primary text-white px-10 py-8 mt-auto">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-6">
          <div className="flex items-center gap-6 flex-1">
            <div className="text-2xl">🌿</div>
            <div className="w-1 h-10 bg-natural-earth rounded-full hidden md:block" />
            <div className="text-sm italic opacity-90">
              <strong>{t.tipTitle}</strong> {t.tipContent}
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-widest opacity-60 font-medium">
            {t.copyright}
          </div>
        </div>
      </footer>

      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

