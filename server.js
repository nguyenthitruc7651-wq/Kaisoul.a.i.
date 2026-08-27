require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname)));

const upload = multer({ dest: "uploads/" });

// Khởi tạo Gemini Client
function getAiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY chưa được cấu hình trong file .env");
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// Endpoint kiểm tra trạng thái
app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "KAISOUL AI server đang hoạt động",
    apiKeyConfigured: !!process.env.GEMINI_API_KEY
  });
});

// Endpoint Chat & Đa phương thức (Text, Vision, Documents, Search)
app.post("/api/chat", upload.array("files"), async (req, res) => {
  try {
    const ai = getAiClient();
    const message = req.body.message || "";
    const systemInstruction = req.body.systemInstruction || "Bạn là KAISOUL AI, trợ lý trí tuệ nhân tạo toàn năng, hữu ích và thân thiện.";
    const memories = req.body.memories ? JSON.parse(req.body.memories) : [];
    const webSearchEnabled = req.body.webSearch === "true";

    let combinedPrompt = message;
    if (memories.length > 0) {
      combinedPrompt = `[Ký ức người dùng đã lưu]:\n${memories.map(m => `- ${m}`).join("\n")}\n\n[Thắc mắc người dùng]: ${message}`;
    }

    const contents = [];
    let extractedDocText = "";

    // Xử lý tệp tải lên
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const mimeType = file.mimetype;
        const filePath = file.path;

        if (mimeType.startsWith("image/")) {
          const imageBytes = fs.readFileSync(filePath).toString("base64");
          contents.push({
            inlineData: {
              data: imageBytes,
              mimeType: mimeType
            }
          });
        } else if (mimeType === "application/pdf") {
          const dataBuffer = fs.readFileSync(filePath);
          const pdfData = await pdfParse(dataBuffer);
          extractedDocText += `\n[Nội dung PDF ${file.originalname}]:\n` + pdfData.text;
        } else if (
          mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          mimeType === "application/vnd.ms-excel"
        ) {
          const workbook = XLSX.readFile(filePath);
          let excelText = "";
          workbook.SheetNames.forEach(sheetName => {
            excelText += `\n--- Sheet: ${sheetName} ---\n`;
            excelText += XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
          });
          extractedDocText += `\n[Nội dung Excel ${file.originalname}]:\n` + excelText;
        } else if (mimeType.startsWith("text/")) {
          const textData = fs.readFileSync(filePath, "utf8");
          extractedDocText += `\n[Nội dung File ${file.originalname}]:\n` + textData;
        }

        // Dọn dẹp tệp tạm
        fs.unlinkSync(filePath);
      }
    }

    if (extractedDocText) {
      combinedPrompt += `\n\n[Tài liệu đính kèm]:${extractedDocText}`;
    }

    contents.push(combinedPrompt);

    const config = {
      systemInstruction: systemInstruction
    };

    if (webSearchEnabled) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: config
    });

    let textResponse = response.text || "KAISOUL AI không thể phản hồi câu hỏi này.";
    let sources = [];

    // Trích xuất nguồn nếu có Web Search
    const searchChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (searchChunks && searchChunks.length > 0) {
      sources = searchChunks
        .filter(chunk => chunk.web)
        .map(chunk => ({ title: chunk.web.title, uri: chunk.web.uri }));
    }

    res.json({
      success: true,
      reply: textResponse,
      sources: sources
    });

  } catch (error) {
    console.error("Lỗi Chat API:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Lỗi xử lý hệ thống KAISOUL AI"
    });
  }
});

// Endpoint Tạo ảnh Imagen
app.post("/api/generate-image", async (req, res) => {
  try {
    const ai = getAiClient();
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: "Thiếu prompt mô tả ảnh." });
    }

    const response = await ai.models.generateImages({
      model: "imagen-3.0-generate-002",
      prompt: prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: "image/jpeg",
        aspectRatio: "1:1"
      }
    });

    const base64Image = response.generatedImages[0].image.imageBytes;
    const imageUrl = `data:image/jpeg;base64,${base64Image}`;

    res.json({ success: true, imageUrl });
  } catch (error) {
    console.error("Lỗi Generate Image API:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Không thể tạo ảnh từ yêu cầu này."
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`KAISOUL AI đang khởi chạy tại http://localhost:${PORT}`);
});
    
