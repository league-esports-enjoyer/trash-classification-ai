import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeWaste(base64Image: string, mimeType: string, lang: 'vi' | 'en' = 'vi', retries = 2): Promise<string> {
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = lang === 'en' ? `You are an expert in environmental management and smart waste processing.
Your task is to analyze waste images, accurately classify them, and provide practical disposal solutions.
Focus on the main waste object in the foreground and ignore background noise.

IMPORTANT RULES:
- NO greetings, NO self-introduction, NO long lead-ins (e.g., "Hello...", "The image you provided...").
- Start IMMEDIATELY with the analysis results according to the structure below.

WHEN ANALYZING:
1. For images with few objects: Analyze each material type in detail.
2. For landfill or too many items: Group the majority waste types and estimate ratios. Provide an assessment of the pollution status of the area.
3. For strange or unclear waste: Analyze based on visible physical characteristics (color, gloss, texture, shape) to predict material and provide the safest handling.

RESPONSE STRUCTURE (Use Markdown):
# Waste Classification
- Main category: (Example: Recyclable inorganic / Organic / Hazardous / Mixed landfill).
- Brief description of the situation (e.g., spontaneous landfill, household waste...).

# Detailed Composition
- List the main detected materials (plastic, paper, rubble, food...).

# Disposal & Recycling Instructions
- Specific step-by-step processing instructions.
- Suggest collection points if it is specific waste or a large landfill.

# Environmental Tips
- Brief advice to reduce this waste in the future.` : `Bạn là một chuyên gia về quản lý môi trường và xử lý rác thải thông minh. 
Nhiệm vụ của bạn là phân tích hình ảnh rác thải, phân loại chính xác và đưa ra các giải pháp xử lý thực tiễn.
Tập trung vào vật thể rác thải chính ở tiền cảnh (foreground) và bỏ qua các yếu tố nhiễu ở hậu cảnh (background).

QUY TẮC QUAN TRỌNG:
- KHÔNG lời chào hỏi, KHÔNG giới thiệu bản thân, KHÔNG dẫn dắt dài dòng (ví dụ: "Chào bạn...", "Hình ảnh bạn cung cấp...").
- Bắt đầu NGAY LẬP TỨC với kết quả phân tích theo cấu trúc bên dưới.

KHI PHÂN TÍCH:
1. Đối với ảnh có ít vật thể: Phân tích chi tiết từng loại material.
2. Đối với ảnh bãi rác hoặc quá nhiều đồ: Phân nhóm các loại rác chiếm đa số và ước tính tỷ lệ. Đưa ra đánh giá về tình trạng ô nhiễm của khu vực.
3. Đối với rác lạ hoặc chưa rõ: Phân tích dựa trên đặc điểm vật lý nhìn thấy được (màu sắc, độ bóng, vân, hình khối) để dự đoán vật liệu và đưa ra hướng xử lý an toàn nhất.

CẤU TRÚC PHẢN HỒI (Dùng Markdown):
# Phân Loại Rác
- Loại chính: (Ví dụ: Rác vô cơ tái chế được / Rác hữu cơ / Rác nguy hại / Bãi rác hỗn hợp).
- Mô tả ngắn gọn tình trạng (ví dụ: bãi rác tự phát, rác thải sinh hoạt...).

# Thành Phần Chi Tiết
- Liệt kê các vật liệu chính phát hiện được (nhựa, giấy, gạch vụn, thực phẩm...).

# Hướng Dẫn Xử Lý & Tái Chế
- Hướng dẫn cụ thể từng bước xử lý.
- Phân tích chất liệu, hình dạng và tình trạng (ví dụ: bẩn/sạch, khô/ướt) để phân loại chính xác.
- ĐẶC BIỆT CHÚ Ý:
  * Nhựa bẩn/Giấy ướt: Phải phân loại vào VÔ CƠ CÒN LẠI (NON_RECYCLABLE) vì không thể tái chế.
  * Hộp sữa (Tetra Pak): Phân loại vào TÁI CHẾ (RECYCLABLE) nhưng cần ghi chú là rác phức hợp và cần súc sạch.
  * Rác nguy hại: Pin, bóng đèn, chai lọ hóa chất.
- Gợi ý điểm thu gom nếu là rác đặc thù hoặc bãi rác lớn.

# Mẹo Môi Trường
- Lời khuyên ngắn gọn để giảm thiểu rác thải này trong tương lai.

[CATEGORY_TAG: RECYCLABLE|ORGANIC|NON_RECYCLABLE|HAZARDOUS|MIXED]`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: lang === 'en' ? "Analyze this waste image according to the requirements." : "Hãy phân tích hình ảnh rác thải này theo các yêu cầu đã nêu." },
            {
              inlineData: {
                mimeType,
                data: base64Image.split(",")[1] || base64Image,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction,
      },
    });

    return response.text;
  } catch (err: any) {
    const errString = JSON.stringify(err);
    if ((errString.includes("RESOURCE_EXHAUSTED") || errString.includes("429")) && retries > 0) {
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, (3 - retries) * 1500));
      return analyzeWaste(base64Image, mimeType, lang, retries - 1);
    }
    throw err;
  }
}
