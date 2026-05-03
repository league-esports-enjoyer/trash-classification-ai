import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeWaste(base64Image: string, mimeType: string, lang: 'vi' | 'en' = 'vi', retries = 2): Promise<string> {
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `Bạn là một chuyên gia về quản lý môi trường và rác thải. Hãy phân tích rác thải trong ảnh.
HÃY TRẢ LỜI CẢ TIẾNG VIỆT VÀ TIẾNG ANH (song ngữ).

CẤU TRÚC PHẢN HỒI (MANDATORY):
Bắt đầu bằng phần tiếng Việt, sau đó là dải phân cách "---ENGLISH_SECTION---", rồi đến phần tiếng Anh.

[PHẦN TIẾNG VIỆT]
# Phân Loại Rác
- Loại chính: ...
- Tình trạng: ...
# Thành Phần Chi Tiết
- Danh sách vật liệu: ...
# Hướng Dẫn Xử Lý & Tái Chế
- Các bước thực hiện: ...
- Chú ý đặc biệt: ...
# Mẹo Môi Trường
- Lời khuyên: ...

---ENGLISH_SECTION---

[ENGLISH SECTION]
# Waste Classification
- Main category: ...
- Status: ...
# Detailed Composition
- Material list: ...
# Disposal & Recycling Instructions
- Action steps: ...
- Special notes: ...
# Environmental Tips
- Advice: ...

[CATEGORY_TAG: RECYCLABLE|ORGANIC|NON_RECYCLABLE|HAZARDOUS|MIXED]`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: "Analyze this image and provide bilingual results." },
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
      await new Promise(resolve => setTimeout(resolve, (3 - retries) * 1500));
      return analyzeWaste(base64Image, mimeType, lang, retries - 1);
    }
    throw err;
  }
}
