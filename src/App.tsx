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

  const extractData = (text: string) => {
    const cleanText = text.replace(/\r/g, "\n");

    const output: string[] = [];

    const tourMatch = cleanText.match(/Tour-Referenz:\s*0*(\d+)/i);

    if (tourMatch) {
      output.push(`📄 Tour: ${tourMatch[1]}`);
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

      const placeMatches = [
        ...block.matchAll(
          /\b(\d{5})\s+([A-ZÄÖÜa-zäöüß\-]+(?:\s+[A-ZÄÖÜa-zäöüß\-]+)?)/gi
        ),
      ];

      if (placeMatches.length === 0) continue;

      const placeMatch = placeMatches[placeMatches.length - 1];

      const plz = placeMatch[1];
      const city = normalizeCity(placeMatch[2]);

      if (!city || city.toLowerCase().includes("zeitfenster")) continue;

      if (/^Laden$/i.test(action)) {
        output.push(`📦 Загрузка Nr. ${loadNr}: ${plz} ${city}`);
        loadNr++;
      }

      if (/^Entladen$/i.test(action)) {
        output.push(`📍 Выгрузка Nr. ${unloadNr}: ${plz} ${city}`);
        unloadNr++;
      }

      const zeitMatch = block.match(
        /Zeitfenster:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}:\d{2})(?:\s*bis\s*(\d{1,2}:\d{2}))?/i
      );

      if (zeitMatch) {
        const date = formatDate(zeitMatch[1]);
        const fromTime = formatTime(zeitMatch[2]);
        const toTime = zeitMatch[3] ? formatTime(zeitMatch[3]) : null;

        output.push(
          toTime ? `${date} ${fromTime} - ${toTime}` : `${date} ${fromTime}`
        );
      }

      output.push("");
    }

    return output.join("\n").trim();
  };

  const processImage = async (file: File) => {
    setStatus("Обработка screenshot...");
    setResult("");

    const {
      data: { text },
    } = await Tesseract.recognize(file, "deu");

    setResult(extractData(text));
    setStatus("Готово");
  };

  const processPdf = async (file: File) => {
    setStatus("Обработка PDF...");
    setResult("");

    const arrayBuffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
    }).promise;

    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item: any) => item.str)
        .join("\n");

      fullText += pageText + "\n";
    }

    setResult(extractData(fullText));
    setStatus("PDF обработан");
  };

  const handleFile = async (file: File) => {
    if (file.type === "application/pdf") {
      await processPdf(file);
      return;
    }

    if (file.type.startsWith("image")) {
      await processImage(file);
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

    const handleDrop = async (event: DragEvent) => {
      event.preventDefault();

      const file = event.dataTransfer?.files?.[0];

      if (file) {
        await handleFile(file);
      }
    };

    const preventDefaults = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("paste", handlePaste);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragover", preventDefaults);

    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragover", preventDefaults);
    };
  }, []);

  const copyText = async () => {
    await navigator.clipboard.writeText(result);
    setStatus("Скопировано");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        background: "#f3f3f5",
        padding: "24px",
        boxSizing: "border-box",
        fontFamily: '"Aptos","Segoe UI",sans-serif',
        overflowX: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            textAlign: "center",
            fontSize: "clamp(38px, 6vw, 72px)",
            fontWeight: 200,
            marginBottom: 30,
            color: "#1d1d1f",
            letterSpacing: "-2px",
          }}
        >
          DSV Tour Data Extractor
        </h1>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 36,
            padding: "clamp(18px, 4vw, 36px)",
            border: "1px solid #e3e3e3",
          }}
        >
          <div
            style={{
              minHeight: 180,
              borderRadius: 28,
              border: "2px dashed #d9d9d9",
              background: "#f3f3f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "clamp(18px, 3vw, 24px)",
              color: "#8d8d8d",
              fontWeight: 300,
              textAlign: "center",
              padding: 20,
            }}
          >
            {status}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 18,
              marginTop: 34,
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                background: "linear-gradient(180deg,#4c78ff,#3765ea)",
                color: "#ffffff",
                padding: "16px 34px",
                borderRadius: 999,
                cursor: "pointer",
                fontSize: 18,
                fontWeight: 400,
                boxShadow: "0 10px 25px rgba(55,101,234,0.25)",
              }}
            >
              Загрузить PDF

              <input
                type="file"
                accept=".pdf,image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];

                  if (file) {
                    handleFile(file);
                  }
                }}
              />
            </label>

            <button
              onClick={copyText}
              style={{
                background: "linear-gradient(180deg,#4c78ff,#3765ea)",
                color: "#ffffff",
                padding: "16px 34px",
                borderRadius: 999,
                cursor: "pointer",
                border: "none",
                fontSize: 18,
                fontWeight: 400,
                boxShadow: "0 10px 25px rgba(55,101,234,0.25)",
              }}
            >
              Скопировать текст
            </button>
          </div>

          <div
            style={{
              marginTop: 36,
              background: "#f3f3f5",
              borderRadius: 28,
              padding: 40,
              border: "1px solid #dddddd",
            }}
          >
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: "#1d1d1f",
                fontSize: "clamp(15px, 2vw, 18px)",
                lineHeight: 2,
                fontFamily: '"Aptos","Segoe UI",sans-serif',
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