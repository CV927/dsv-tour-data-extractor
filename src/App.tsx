import { useEffect, useState } from "react";
import Tesseract from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function App() {
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("Вставьте screenshot или PDF");

  const formatDate = (date: string) => {
    const parts = date.replace(/\s/g, "").split(".");
    if (parts.length !== 3) return date;

    return `${parts[0].padStart(2, "0")}.${parts[1].padStart(
      2,
      "0"
    )}.${parts[2]}`;
  };

  const formatTime = (time: string) => {
    const clean = time.replace(/\s/g, "");
    const [h, m] = clean.split(":");

    return `${h.padStart(2, "0")}:${m || "00"}`;
  };

  const normalizeCity = (city: string) =>
    city
      .replace(/\bZeitfenster\b/gi, "")
      .replace(/\bDatum\b/gi, "")
      .replace(/\bSitz\b/gi, "")
      .replace(/[-]+/g, "")
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // SCREENSHOT OCR
  const extractFromImage = (text: string) => {
    const cleanText = text.replace(/\r/g, "");

    const lines = cleanText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const tourMatch = cleanText.match(/Tour-Referenz:\s*0*(\d+)/i);

    const tour = tourMatch ? tourMatch[1] : "";

    const output: string[] = [];

    if (tour) {
      output.push(`Tour: ${tour}`);
      output.push("");
    }

    let loadNr = 1;
    let unloadNr = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const isLoad =
        /\bLaden\b/i.test(line) &&
        !/\bEntladen\b/i.test(line);

      const isUnload =
        /\bEntladen\b/i.test(line);

      if (!isLoad && !isUnload) continue;

      const placeBlock = lines.slice(i, i + 5).join(" ");

      const timeBlock = lines.slice(i, i + 7).join(" ");

      const placeMatch = placeBlock.match(
        /\b(\d{5})\s+([A-ZÄÖÜa-zäöüß\-]+(?:\s+[A-ZÄÖÜa-zäöüß\-]+)?)/i
      );

      if (!placeMatch) continue;

      const plz = placeMatch[1];

      const city = normalizeCity(placeMatch[2]);

      if (isLoad) {
        output.push(`Загрузка Nr. ${loadNr}: ${plz} ${city}`);
        loadNr++;
      }

      if (isUnload) {
        output.push(`Выгрузка Nr. ${unloadNr}: ${plz} ${city}`);
        unloadNr++;
      }

      const zeitMatch = timeBlock.match(
        /Zeitfenster:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}:\d{2})/i
      );

      if (zeitMatch) {
        output.push(
          `${formatDate(zeitMatch[1])} ${formatTime(
            zeitMatch[2]
          )}`
        );
      }

      output.push("");
    }

    return output.join("\n").trim();
  };

  // PDF PARSER
  const extractFromPdf = (text: string) => {
    const cleanText = text.replace(/\r/g, "\n");

    const tourMatch = cleanText.match(
      /Tour-Referenz:\s*0*(\d+)/i
    );

    const tour = tourMatch ? tourMatch[1] : "";

    const output: string[] = [];

    if (tour) {
      output.push(`Tour: ${tour}`);
      output.push("");
    }

    const stopRegex =
      /(?:^|\n)\s*(\d+)\s+(Laden|Entladen)\s+([\s\S]*?)(?=(?:\n)\s*\d+\s+(?:Laden|Entladen)\s|(?:\n)\s*Datum:|$)/gi;

    let loadNr = 1;
    let unloadNr = 1;

    let match;

    while ((match = stopRegex.exec(cleanText)) !== null) {
      const action = match[2];

      const block = match[3];

      const placeMatch = block.match(
        /\b(\d{5})\s+([A-ZÄÖÜa-zäöüß\-]+(?:\s+[A-ZÄÖÜa-zäöüß\-]+)?)/i
      );

      if (!placeMatch) continue;

      const plz = placeMatch[1];

      const city =
        placeMatch[2]
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()) || "";

      if (/^Laden$/i.test(action)) {
        output.push(`Загрузка Nr. ${loadNr}: ${plz} ${city}`);
        loadNr++;
      }

      if (/^Entladen$/i.test(action)) {
        output.push(`Выгрузка Nr. ${unloadNr}: ${plz} ${city}`);
        unloadNr++;
      }

      const zeitMatch = block.match(
        /Zeitfenster:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}:\d{2})/i
      );

      if (zeitMatch) {
        output.push(
          `${formatDate(zeitMatch[1])} ${formatTime(
            zeitMatch[2]
          )}`
        );
      }

      output.push("");
    }

    return output.join("\n").trim();
  };

  const readPdf = async (file: File) => {
    setStatus("Обработка PDF...");
    setResult("");

    const buffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
    }).promise;

    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);

      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item: any) => item.str)
        .join("\n");

      fullText += pageText + "\n";
    }

    setResult(extractFromPdf(fullText));
    setStatus("PDF обработан");
  };

  const readImage = async (file: File) => {
    setStatus("Обработка screenshot...");
    setResult("");

    const {
      data: { text },
    } = await Tesseract.recognize(file, "deu");

    setResult(extractFromImage(text));
    setStatus("Готово");
  };

  const handleFile = async (file: File) => {
    if (file.type === "application/pdf") {
      await readPdf(file);
      return;
    }

    if (file.type.startsWith("image")) {
      await readImage(file);
      return;
    }

    setStatus("Файл не поддерживается");
  };

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;

      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const file = items[i].getAsFile();

        if (file) {
          await handleFile(file);
          break;
        }
      }
    };

    const preventDefault = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDrop = async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const file = event.dataTransfer?.files?.[0];

      if (file) {
        await handleFile(file);
      }
    };

    window.addEventListener("paste", handlePaste);
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  const copyResult = async () => {
    await navigator.clipboard.writeText(result);
    setStatus("Скопировано");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f7",
        padding: 30,
        boxSizing: "border-box",
        fontFamily: '"Aptos", "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            textAlign: "center",
            fontSize: "clamp(48px, 6vw, 78px)",
            fontWeight: 200,
            color: "#1d1d1f",
            marginBottom: 34,
            letterSpacing: "-2px",
          }}
        >
          DSV Tour Data Extractor
        </h1>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 36,
            border: "1px solid #e8e8e8",
            padding: 34,
            boxShadow: "0 20px 60px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              border: "2px dashed #d8d8d8",
              borderRadius: 28,
              minHeight: 180,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: 20,
              fontSize: "clamp(18px, 3vw, 26px)",
              color: "#8c8c8c",
              fontWeight: 300,
              background: "#f5f5f7",
            }}
          >
            {status}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 14,
              flexWrap: "wrap",
              marginTop: 34,
            }}
          >
            <label
              style={{
                background:
                  "linear-gradient(180deg,#3f82ff,#2563eb)",
                color: "#ffffff",
                borderRadius: 999,
                padding: "16px 34px",
                fontSize: 16,
                fontWeight: 400,
                cursor: "pointer",
                boxShadow:
                  "0 10px 25px rgba(37,99,235,0.25)",
              }}
            >
              Загрузить PDF

              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];

                  if (file) {
                    handleFile(file);
                  }
                }}
                style={{ display: "none" }}
              />
            </label>

            {result && (
              <button
                onClick={copyResult}
                style={{
                  background:
                    "linear-gradient(180deg,#3f82ff,#2563eb)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 999,
                  padding: "16px 34px",
                  fontSize: 16,
                  fontWeight: 400,
                  cursor: "pointer",
                  boxShadow:
                    "0 10px 25px rgba(37,99,235,0.25)",
                }}
              >
                Скопировать текст
              </button>
            )}
          </div>

          <div
            style={{
              marginTop: 34,
              background: "#f5f5f7",
              borderRadius: 30,
              padding: 34,
              border: "1px solid #e1e1e1",
            }}
          >
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "#1d1d1f",
                fontSize: "clamp(16px, 2vw, 19px)",
                lineHeight: 1.9,
                textAlign: "left",
                fontWeight: 400,
                fontFamily:
                  '"Aptos", "Segoe UI", sans-serif',
              }}
            >
              {result || "Здесь появится готовый текст..."}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}