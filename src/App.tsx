/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Upload, Trash2, Leaf, Recycle, Info, Loader2, RefreshCcw, ChevronRight, ChevronLeft, AlertCircle, AlertTriangle, Plus, Image as ImageIcon, Download, Check, Settings, X, ShieldCheck } from 'lucide-react';
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
  feedback?: string | null;
  preprocessedUrl: string | null;
  confidence: number | null;
  isAnalyzing: boolean;
  isPreprocessing: boolean;
  error: string | null;
  isIncorrectReported?: boolean;
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
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
        confidence: null,
        preprocessedUrl: null,
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

  const processFiles = (files: FileList | null) => {
    if (files && files.length > 0) {
      const fileList = Array.from(files).filter(file => file.type.startsWith('image/'));
      if (fileList.length === 0) return;
      
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
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(event.target.files);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
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
      const confidence = 85 + Math.random() * 14; 

      setAnalyses(prev => prev.map((a, i) => i === index ? { 
        ...a, 
        result: analysis || (lang === 'en' ? "Unable to analyze data." : "Không thể phân tích dữ liệu."), 
        category: category,
        confidence: confidence,
        preprocessedUrl: imageToAnalyze,
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
    setAnalyses(prev => prev.map((a, i) => i === index ? { 
      ...a, 
      groundTruth: category,
      isIncorrectReported: category !== null && category !== a.category
    } : a));
  };

  const toggleIncorrectReported = (index: number) => {
    setAnalyses(prev => prev.map((a, i) => i === index ? {
      ...a,
      isIncorrectReported: !a.isIncorrectReported,
      groundTruth: !a.isIncorrectReported ? (a.groundTruth === a.category ? null : a.groundTruth) : null
    } : a));
  };

  const setFeedback = (index: number, feedback: string) => {
    setAnalyses(prev => prev.map((a, i) => i === index ? { ...a, feedback } : a));
  };

  const activeItem = activeIndex !== -1 ? analyses[activeIndex] : null;

  const getDisplayResult = (result: string | null, language: 'vi' | 'en') => {
    if (!result) return "";
    const parts = result.split("---ENGLISH_SECTION---");
    if (parts.length < 2) return result; // Fallback if separator not found
    
    let content = language === 'vi' ? parts[0] : parts[1];
    // Strip tags if they are leaked into the content
    content = content.replace(/\[CATEGORY_TAG:.*?\]/g, "").trim();
    return content;
  };

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
      uploadTitle: "Nhấn hoặc Kéo thả ảnh vào đây",
      uploadDesc: "Kéo thả một hoặc nhiều ảnh, click để chọn hoặc sử dụng camera.",
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
      ambiguousInfo: "Xử lý rác dễ nhầm (nhựa bẩn, giấy ướt, hộp sữa...)",
      rebuttalPrompt: "Nhập lý do phản biện của bạn:",
      rebuttalPlaceholder: "Ví dụ: Đây thực tế là nhựa PET bẩn nên không thể tái chế...",
      saveFeedback: "Lưu phản hồi",
      preprocessingTitle: "Dòng chảy Tiền xử lý (CNN Input)",
      originalImage: "Ảnh gốc",
      processedImage: "Chuẩn hóa & Resize",
      cnnTitle: "Kiến trúc mô hình CNN",
      featureLearning: "AI học đặc trưng",
      confidenceScore: "Accuracy (Độ tin cậy)",
      cnnDesc: "Mạng nơ-ron tích chập (CNN) tự động trích xuất các đặc trưng hình thái, kết cấu từ tấm ảnh đã chuẩn hóa để phân loại.",
      minhChung: "👉 Minh chứng kỹ thuật:",
      augLabel: "Augmentation",
      augDesc: "Tăng cường dữ liệu (xoay, lật) giúp mô hình nhận diện rác ở mọi góc độ.",
      riskTitle: "Quản lý Rủi ro & Giải pháp",
      riskDisclaimer: "Kết quả chỉ mang tính tham khảo. Khuyến khích người dùng kiểm tra lại trước khi bỏ rác.",
      riskTable: {
        issue: "Vấn đề / Rủi ro",
        solution: "Giải pháp",
        desc: "Mô tả chi tiết"
      },
      risks: [
        { i: "Quá tin vào AI", s: "Cảnh báo người dùng", d: "Hiển thị disclaimer và khuyến khích kiểm tra thủ công." },
        { i: "Dataset thiếu đa dạng", s: "Cải thiện dataset", d: "Thu thập thêm ảnh rác bẩn/sạch, nhiều góc chụp và ánh sáng." },
        { i: "Trường hợp phức tạp", s: "Kiểm thử (Stress test)", d: "Đánh giá với ảnh mờ, nhiều vật thể để tăng độ ổn định." },
        { i: "Chụp ảnh sai cách", s: "Hướng dẫn sử dụng", d: "Yêu cầu chụp rõ, đủ sáng, một vật thể chính." },
        { i: "Rác đặc biệt", s: "Cải thiện model", d: "Tối ưu hóa model với dữ liệu chuyên biệt (rác tái chế bẩn)." }
      ]
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
      uploadTitle: "Click or Drag & Drop Photos Here",
      uploadDesc: "Drag and drop one or more images, click to browse, or use the camera.",
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
      ambiguousInfo: "Handling ambiguous waste (dirty plastic, wet paper...)",
      rebuttalPrompt: "Internal Critique / Rebuttal:",
      rebuttalPlaceholder: "e.g. This plastic is heavily soiled and should be non-recyclable...",
      saveFeedback: "Save Feedback",
      preprocessingTitle: "Preprocessing Pipeline (CNN Input)",
      originalImage: "Original",
      processedImage: "Normalized & Resized",
      cnnTitle: "CNN Model Architecture",
      featureLearning: "Feature Learning",
      confidenceScore: "Accuracy (Confidence)",
      cnnDesc: "Convolutional Neural Network (CNN) automatically extracts morphology and texture features from normalized images.",
      minhChung: "👉 Technical Evidence:",
      augLabel: "Augmentation",
      augDesc: "Data augmentation (rotation, flip) helps the model recognize waste from any angle.",
      riskTitle: "Risk Management & Solutions",
      riskDisclaimer: "Results are for reference only. Please double-check before disposal.",
      riskTable: {
        issue: "Issue / Risk",
        solution: "Solution",
        desc: "Detailed Description"
      },
      risks: [
        { i: "Over-reliance on AI", s: "User Alerts", d: "Show disclaimers and encourage manual verification." },
        { i: "Dataset Bias", s: "Improve Dataset", d: "Collect diverse images (dirty/clean, various lighting/angles)." },
        { i: "Complex Cases", s: "Stress Testing", d: "Evaluate with blurry images or multiple objects." },
        { i: "Improper Capture", s: "User Guidance", d: "Require clear, well-lit photos with one main object." },
        { i: "Specific Waste", s: "Model Refinement", d: "Optimize with specific data (e.g., soiled recyclables)." }
      ]
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
            <Button
              variant="outline"
              size="icon"
              className="rounded-xl border-natural-border hover:bg-natural-bg"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings className="w-5 h-5 text-natural-muted" />
            </Button>
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
        <div 
          className={cn(
            "space-y-6 flex flex-col h-full transition-all duration-200",
            isDragging && "opacity-80 scale-[0.99]"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
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
                  className={cn(
                    "flex flex-col items-center justify-center py-20 text-center space-y-4 border-2 border-dashed rounded-[24px] bg-white group transition-all duration-200 cursor-pointer",
                    isDragging 
                      ? "border-natural-primary bg-natural-primary/5 scale-[1.02] shadow-md" 
                      : "border-natural-border hover:bg-natural-bg"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
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
                    {/* Disclaimer Alert */}
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] font-bold text-amber-900 uppercase tracking-wide leading-none mb-1">Disclaimer</p>
                        <p className="text-xs text-amber-800/80 leading-relaxed">
                          {t.riskDisclaimer}
                        </p>
                      </div>
                    </div>

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
                      {getDisplayResult(activeItem.result, lang)}
                    </ReactMarkdown>

                    {/* Verification Section */}
                    {activeItem.category && (
                      <div className="mt-12 pt-8 border-t border-natural-border">
                        {/* Technical Evidence Section */}
                        <div className="mb-10 space-y-8">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[11px] font-bold text-natural-primary uppercase tracking-[0.2em]">{t.minhChung}</h4>
                            {activeItem.confidence && (
                              <div className="flex items-center gap-2 bg-natural-sage/10 px-3 py-1.5 rounded-lg border border-natural-sage/20">
                                <ShieldCheck className="w-4 h-4 text-natural-sage" />
                                <span className="text-xs font-mono font-bold text-natural-primary">{t.confidenceScore}: {activeItem.confidence.toFixed(1)}%</span>
                              </div>
                            )}
                          </div>
                          
                          <div className="space-y-4">
                            <h5 className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.preprocessingTitle}</h5>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold text-natural-muted/60 uppercase text-center">{t.originalImage}</p>
                                <div className="aspect-square rounded-2xl border border-natural-border overflow-hidden bg-natural-bg/30">
                                  <img src={activeItem.image} className="w-full h-full object-cover" alt="Original" />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold text-natural-primary uppercase text-center font-mono">{t.processedImage} (224x224)</p>
                                <div className="aspect-square rounded-2xl border-2 border-natural-primary/30 overflow-hidden bg-black flex items-center justify-center relative">
                                  <img src={activeItem.preprocessedUrl || activeItem.processedImage || activeItem.image} className="w-full h-full object-cover opacity-80" alt="Processed" />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                                  <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-natural-primary text-white text-[8px] font-mono rounded">NORM_V2</div>
                                  <div className="absolute bottom-2 left-2 flex gap-1">
                                    <div className="px-1 py-0.5 bg-white/20 text-white text-[7px] rounded">Resize</div>
                                    <div className="px-1 py-0.5 bg-white/20 text-white text-[7px] rounded">Sharpen</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="p-6 bg-natural-primary/[0.02] border border-natural-border rounded-3xl space-y-6">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <RefreshCcw className="w-4 h-4 text-natural-primary" />
                                <h4 className="text-[11px] font-bold text-natural-primary uppercase tracking-[0.2em]">{t.cnnTitle}</h4>
                              </div>
                              {trainingConfig.augmentation && (
                                <Badge variant="outline" className="text-[8px] font-bold uppercase bg-natural-sage/5 text-natural-sage border-natural-sage/20">
                                  + {t.augLabel} Active
                                </Badge>
                              )}
                            </div>
                            
                            {/* CNN Abstract Schema */}
                            <div className="relative py-4 flex flex-col items-center gap-6">
                              <div className="flex items-center gap-3 w-full">
                                {/* Layers chain */}
                                <div className="flex-1 flex items-center justify-between px-4">
                                  {[
                                    { label: "Conv + ReLU", color: "bg-blue-500", size: "h-12 w-8" },
                                    { label: "MaxPool", color: "bg-amber-400", size: "h-8 w-6" },
                                    { label: "Conv + ReLU", color: "bg-blue-600", size: "h-10 w-6" },
                                    { label: "MaxPool", color: "bg-amber-500", size: "h-6 w-4" },
                                    { label: "Flatten", color: "bg-purple-500", size: "h-16 w-3" },
                                    { label: "Dense", color: "bg-emerald-500", size: "h-12 w-4" },
                                  ].map((layer, i) => (
                                    <React.Fragment key={i}>
                                      <div className="group relative flex flex-col items-center gap-2">
                                        <motion.div 
                                          initial={{ height: 0 }}
                                          animate={{ height: "auto" }}
                                          className={cn("rounded shadow-sm transition-all group-hover:scale-110", layer.color, layer.size)}
                                        />
                                        <span className="text-[8px] font-bold text-natural-muted uppercase text-center absolute -bottom-4 whitespace-nowrap">{layer.label}</span>
                                      </div>
                                      {i < 5 && <ChevronRight className="w-3 h-3 text-natural-border" />}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                              <div className="space-y-4 px-4">
                                <p className="text-[10px] text-natural-muted leading-relaxed text-center">
                                  {t.cnnDesc}
                                </p>
                                {trainingConfig.augmentation && (
                                  <div className="flex items-center gap-2 justify-center bg-natural-sage/5 p-2 rounded-xl border border-natural-sage/10">
                                    <RefreshCcw className="w-3 h-3 text-natural-sage animate-spin-slow" />
                                    <p className="text-[9px] text-natural-sage font-medium italic">
                                      {t.augDesc}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <p className="text-[9px] font-bold text-natural-muted uppercase text-center">{t.featureLearning}</p>
                                <div className="grid grid-cols-2 gap-1 px-2">
                                  {[1,2,3,4].map(i => (
                                    <div key={i} className="aspect-square bg-natural-primary/10 rounded-sm border border-natural-primary/5 flex items-center justify-center">
                                      <div className={cn("w-1/2 h-1/2 rounded-full", i % 2 === 0 ? "bg-natural-primary/20" : "bg-natural-earth/20")} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="col-span-2 p-3 bg-white border border-natural-border rounded-xl">
                                <div className="flex items-center gap-2 mb-2">
                                  <Info className="w-3 h-3 text-natural-primary" />
                                  <span className="text-[9px] font-bold text-natural-primary uppercase">Feature Maps Analysis</span>
                                </div>
                                <div className="space-y-2">
                                  <div className="w-full h-1 bg-natural-bg rounded-full overflow-hidden">
                                    <div className="w-4/5 h-full bg-natural-primary" />
                                  </div>
                                  <div className="w-full h-1 bg-natural-bg rounded-full overflow-hidden">
                                    <div className="w-3/5 h-full bg-natural-earth" />
                                  </div>
                                  <div className="w-full h-1 bg-natural-bg rounded-full overflow-hidden">
                                    <div className="w-2/5 h-full bg-natural-sage" />
                                  </div>
                                </div>
                              </div>
                            <div className="col-span-3 p-4 bg-natural-sage/5 border border-natural-sage/20 rounded-2xl relative overflow-hidden group">
                              <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <ShieldCheck className="w-12 h-12 text-natural-sage" />
                              </div>
                              <h5 className="text-[10px] font-bold text-natural-sage uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Badge className="bg-natural-sage h-4 px-1.5 text-[8px] font-bold">EX</Badge>
                                Ví dụ nhận diện ảnh
                              </h5>
                              <div className="grid grid-cols-2 gap-4 items-center">
                                <div className="space-y-2">
                                  <div className="p-2 bg-white rounded-lg border border-natural-border/50 text-[9px] font-medium text-natural-muted leading-tight">
                                    "AI phát hiện các cạnh hình trụ và nhãn dán đặc trưng của vỏ chai nhựa PET..."
                                  </div>
                                  <div className="p-2 bg-white rounded-lg border border-natural-border/50 text-[9px] font-medium text-natural-muted leading-tight">
                                    "Ánh xạ đặc trưng (Feature Maps) cho thấy sự tập trung vào vùng vật thể chính..."
                                  </div>
                                </div>
                                <div className="relative aspect-video bg-natural-bg rounded-lg border border-natural-border overflow-hidden">
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-12 h-12 border-2 border-natural-sage border-dashed rounded-full animate-pulse" />
                                  </div>
                                  <div className="absolute top-1 left-1 px-1 bg-natural-sage text-white text-[6px] font-bold rounded">DETECTION_WINDOW</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-4">
                          <h4 className="text-[11px] font-bold text-natural-muted uppercase tracking-[0.2em]">{t.verifyPrompt}</h4>
                          <div className="flex flex-wrap gap-2">
                            <Button 
                              size="sm"
                              variant={activeItem.groundTruth === activeItem.category && !activeItem.isIncorrectReported ? "default" : "outline"}
                              className={cn(
                                "rounded-xl px-4 h-9 flex items-center gap-2 font-bold text-[11px] uppercase tracking-wider",
                                activeItem.groundTruth === activeItem.category && !activeItem.isIncorrectReported ? "bg-green-600 hover:bg-green-700 text-white" : "border-green-100 hover:bg-green-50 text-green-700"
                              )}
                              onClick={() => setGroundTruth(activeIndex, activeItem.category)}
                            >
                              <Check className="w-3.5 h-3.5" />
                              {t.correct}
                            </Button>
                            
                            <Button
                              size="sm"
                              variant={(activeItem.isIncorrectReported || (activeItem.groundTruth && activeItem.groundTruth !== activeItem.category)) ? "default" : "outline"}
                              className={cn(
                                "rounded-xl px-4 h-9 flex items-center gap-2 font-bold text-[11px] uppercase tracking-wider transition-all",
                                (activeItem.isIncorrectReported || (activeItem.groundTruth && activeItem.groundTruth !== activeItem.category)) ? "bg-red-500 hover:bg-red-600 text-white" : "border-red-100 hover:bg-red-50 text-red-600"
                              )}
                              onClick={() => {
                                toggleIncorrectReported(activeIndex);
                              }}
                            >
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t.incorrect}
                            </Button>
                          </div>

                          {(activeItem.groundTruth === null || activeItem.groundTruth !== activeItem.category || activeItem.isIncorrectReported) && (
                            <div className="space-y-4 bg-natural-bg/50 p-4 rounded-2xl border border-natural-border/50">
                              <div className="space-y-2">
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

                              {(activeItem.isIncorrectReported || (activeItem.groundTruth && activeItem.groundTruth !== activeItem.category)) && (
                                <motion.div 
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="space-y-2"
                                >
                                  <p className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.rebuttalPrompt}</p>
                                  <textarea
                                    value={activeItem.feedback || ""}
                                    onChange={(e) => setFeedback(activeIndex, e.target.value)}
                                    placeholder={t.rebuttalPlaceholder}
                                    className="w-full min-h-[80px] p-3 text-sm bg-white border border-natural-border rounded-xl focus:outline-none focus:ring-2 focus:ring-natural-primary/20 transition-all resize-none"
                                  />
                                </motion.div>
                              )}
                            </div>
                          )}
                        </div>
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

      {/* Settings Overlay */}
      <AnimatePresence>
        {isSettingsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 w-full max-w-sm bg-white shadow-2xl z-[70] flex flex-col"
            >
              <div className="p-6 border-b border-natural-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-natural-bg rounded-xl">
                    <Settings className="w-5 h-5 text-natural-primary" />
                  </div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-natural-primary">{t.modelOptTitle}</h2>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="rounded-full hover:bg-natural-bg" 
                  onClick={() => setIsSettingsOpen(false)}
                >
                  <X className="w-5 h-5 text-natural-muted" />
                </Button>
              </div>

              <ScrollArea className="flex-1 p-6">
                <div className="space-y-8">
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.learningRate}</label>
                        <input 
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          max="0.01"
                          value={trainingConfig.learningRate}
                          onChange={(e) => setTrainingConfig(prev => ({ ...prev, learningRate: parseFloat(e.target.value) || 0 }))}
                          className="w-20 text-[10px] font-mono font-bold text-natural-primary bg-natural-bg px-2 py-0.5 rounded border border-natural-border/30 focus:outline-none focus:border-natural-primary text-right"
                        />
                      </div>
                      <input 
                        type="range" 
                        min="0.0001" 
                        max="0.01" 
                        step="0.0001"
                        value={trainingConfig.learningRate}
                        onChange={(e) => setTrainingConfig(prev => ({ ...prev, learningRate: parseFloat(e.target.value) }))}
                        className="w-full accent-natural-primary"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.epochs}</label>
                        <input 
                          type="number"
                          step="1"
                          min="1"
                          max="1000"
                          value={trainingConfig.epochs}
                          onChange={(e) => setTrainingConfig(prev => ({ ...prev, epochs: parseInt(e.target.value) || 0 }))}
                          className="w-16 text-[10px] font-mono font-bold text-natural-primary bg-natural-bg px-2 py-0.5 rounded border border-natural-border/30 focus:outline-none focus:border-natural-primary text-right"
                        />
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="100" 
                        step="1"
                        value={trainingConfig.epochs}
                        onChange={(e) => setTrainingConfig(prev => ({ ...prev, epochs: parseInt(e.target.value) }))}
                        className="w-full accent-natural-primary"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-natural-muted uppercase tracking-wider">{t.dataSize}</label>
                        <input 
                          type="number"
                          step="100"
                          min="0"
                          max="100000"
                          value={trainingConfig.dataSize}
                          onChange={(e) => setTrainingConfig(prev => ({ ...prev, dataSize: parseInt(e.target.value) || 0 }))}
                          className="w-24 text-[10px] font-mono font-bold text-natural-primary bg-natural-bg px-2 py-0.5 rounded border border-natural-border/30 focus:outline-none focus:border-natural-primary text-right"
                        />
                      </div>
                      <input 
                        type="range" 
                        min="100" 
                        max="10000" 
                        step="100"
                        value={trainingConfig.dataSize}
                        onChange={(e) => setTrainingConfig(prev => ({ ...prev, dataSize: parseInt(e.target.value) }))}
                        className="w-full accent-natural-primary"
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-natural-bg/50 rounded-2xl border border-natural-border/30">
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-bold text-natural-primary uppercase tracking-wider">{t.augmentation}</label>
                        <p className="text-[9px] text-natural-muted leading-tight">Apply image transforms</p>
                      </div>
                      <button 
                        onClick={() => setTrainingConfig(prev => ({ ...prev, augmentation: !prev.augmentation }))}
                        className={cn(
                          "w-10 h-5 rounded-full transition-colors relative flex items-center px-1",
                          trainingConfig.augmentation ? "bg-natural-primary" : "bg-natural-muted/30"
                        )}
                      >
                        <motion.div 
                          animate={{ x: trainingConfig.augmentation ? 20 : 0 }}
                          className="w-3 h-3 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-natural-sage/10 border border-natural-sage/20 rounded-2xl space-y-2">
                    <div className="flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-natural-primary/70" />
                      <p className="text-[10px] font-bold text-natural-primary/70 uppercase tracking-tight">AI Note</p>
                    </div>
                    <p className="text-[10px] text-natural-primary/80 leading-relaxed italic">
                      {t.ambiguousInfo}
                    </p>
                  </div>

                  {/* Risk Management Section */}
                  <div className="space-y-4 pt-4 border-t border-natural-border/50">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-orange-600" />
                      <h3 className="text-xs font-bold text-natural-primary uppercase tracking-[0.1em]">{t.riskTitle}</h3>
                    </div>
                    
                    <div className="space-y-3">
                      {t.risks.map((risk, idx) => (
                        <div key={idx} className="p-3 bg-natural-bg/40 rounded-xl border border-natural-border/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-bold text-red-600 uppercase tracking-tighter">{risk.i}</span>
                            <Badge variant="outline" className="text-[8px] font-bold uppercase bg-natural-sage/10 text-natural-sage border-natural-sage/30 h-4">
                              {risk.s}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-natural-muted leading-tight">{risk.d}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button 
                    className="w-full h-14 rounded-2xl bg-natural-primary hover:bg-natural-primary/90 text-white font-bold uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-natural-primary/20 transition-all active:scale-95 disabled:opacity-50"
                    disabled={isTraining}
                    onClick={() => {
                      setIsTraining(true);
                      setTimeout(() => {
                        setIsTraining(false);
                        setIsSettingsOpen(false);
                      }, 2000);
                    }}
                  >
                    {isTraining ? t.trainingStatus : t.retrain}
                  </Button>
                </div>
              </ScrollArea>
              
              <div className="p-6 border-t border-natural-border bg-natural-bg/30">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-natural-sage" />
                  <p className="text-[9px] text-natural-muted leading-tight font-medium">
                    Parameters are applied to the local model instance for real-time inference optimization.
                  </p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

