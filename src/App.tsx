import { useEffect, useState } from "react";
import Tesseract from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

type Spedition = "DSV" | "DHL";

type Stop = {
  plz: string;
  city: string;
  time?: string;
};

export default function App() {
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("Вставьте screenshot или PDF");

  const [spedition, setSpedition] = useState<Spedition>(() => {
    const saved = localStorage.getItem("spedition");
    return saved === "DHL" ? "DHL" : "DSV";
  });

  useEffect(() => {
    localStorage.setItem("spedition", spedition);
  }, [spedition]);

  const normalizeCity = (city: string) => {
    const clean = city.replace(/\s+/g, " ").trim().toLowerCase();

    return clean
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const formatDate = (date: string) => {
    const p = date.replace(/\s/g, "").split(".");
    if (p.length !== 3) return date;

    return `${p[0].padStart(2, "0")}.${p[1].padStart(2, "0")}.${p[2]}`;
  };

  const formatTime = (time: string) => {
    const clean = time.replace(/\s/g, "");
    const [h, m] = clean.split(":");

    return `${h.padStart(2, "0")}:${m || "00"}`;
  };

  const buildInterval = (
    startDate?: string,
    startTime?: string,
    endDate?: string,
    endTime?: string
  ) => {
    if (!startDate || !startTime) return "";

    const date = formatDate(startDate);

    if (!endTime) {
      return `${date} ${formatTime(startTime)}`;
    }

    return `${date} ${formatTime(startTime)} - ${formatTime(endTime)}`;
  };

  const parseSortableTime = (time?: string) => {
    if (!time) return Number.MAX_SAFE_INTEGER;

    const match = time.match(
      /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/
    );

    if (!match) return Number.MAX_SAFE_INTEGER;

    const [, dd, mm, yyyy, hh, min] = match;

    return new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min)
    ).getTime();
  };

  const extractDSV = (text: string) => {
    const output: string[] = [];

    const cleanText = text.replace(/\r/g, "\n");

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
      const type = match[2].trim();
      const block = match[3];

      const placeMatches = [
        ...block.matchAll(
          /\b(\d{5})\s+([A-ZÄÖÜa-zäöüß\-]+(?:\s+[A-ZÄÖÜa-zäöüß\-]+)?)/gi
        ),
      ];

      if (placeMatches.length === 0) continue;

      const placeMatch = placeMatches[placeMatches.length - 1];

      const plz = placeMatch[1];

      const city = normalizeCity(
        placeMatch[2]
          .replace(/\bZeitfenster\b/gi, "")
          .replace(/\bDatum\b/gi, "")
          .replace(/-/g, " ")
          .trim()
      );

      const zeit = block.match(
        /Zeitfenster:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}:\d{2})(?:\s*bis\s*(\d{1,2}:\d{2}))?/i
      );

      let time = "";

      if (zeit) {
        time = zeit[3]
          ? `${formatDate(zeit[1])} ${formatTime(zeit[2])} - ${formatTime(
            zeit[3]
          )}`
          : `${formatDate(zeit[1])} ${formatTime(zeit[2])}`;
      }

      if (type.toLowerCase() === "laden") {
        output.push(`📦 Загрузка Nr. ${loadNr}: ${plz} ${city}`);

        if (time) output.push(time);

        output.push("");
        loadNr++;
      }

      if (type.toLowerCase() === "entladen") {
        output.push(`📍 Выгрузка Nr. ${unloadNr}: ${plz} ${city}`);

        if (time) output.push(time);

        output.push("");
        unloadNr++;
      }
    }

    return output.join("\n").trim();
  };

  const extractDHL = (text: string) => {
    const output: string[] = [];

    const clean = text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ");

    const tourMatch =
      clean.match(/TourNr\.?:?\s*(\d{6,})/i) ||
      clean.match(/\b(10\d{6})\b/);

    if (tourMatch) {
      output.push(`📄 Tour: ${tourMatch[1]}`);
      output.push("");
    }

    const loads: Stop[] = [];
    const unloads: Stop[] = [];

    const positionBlocks = clean
      .split(/(?=Position:\s*\d+)/i)
      .filter((b) => /Position:/i.test(b));

    for (const block of positionBlocks) {
      const loadAddress =
        block.match(/Versender:[\s\S]*?D-(\d{5})\s+([A-ZÄÖÜ]+)/i) ||
        block.match(/Consignor:[\s\S]*?D-(\d{5})\s+([A-ZÄÖÜ]+)/i);

      const unloadAddress =
        block.match(/Empfänger:[\s\S]*?D-(\d{5})\s+([A-ZÄÖÜ]+)/i) ||
        block.match(/Consignee:[\s\S]*?D-(\d{5})\s+([A-ZÄÖÜ]+)/i);

      const dates = [
        ...block.matchAll(/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/g),
      ];

      let loadTime = "";
      let unloadTime = "";

      if (dates.length >= 2) {
        loadTime = buildInterval(
          dates[0][1],
          dates[0][2],
          dates[1][1],
          dates[1][2]
        );
      }

      if (dates.length >= 4) {
        unloadTime = buildInterval(
          dates[2][1],
          dates[2][2],
          dates[3][1],
          dates[3][2]
        );
      }

      if (loadAddress) {
        const stop = {
          plz: loadAddress[1],
          city: normalizeCity(loadAddress[2]),
          time: loadTime,
        };

        const exists = loads.some(
          (s) => s.plz === stop.plz && s.city === stop.city
        );

        if (!exists) loads.push(stop);
      }

      if (unloadAddress) {
        const stop = {
          plz: unloadAddress[1],
          city: normalizeCity(unloadAddress[2]),
          time: unloadTime,
        };

        const exists = unloads.some(
          (s) => s.plz === stop.plz && s.city === stop.city
        );

        if (!exists) unloads.push(stop);
      }
    }

    loads.sort(
      (a, b) => parseSortableTime(a.time) - parseSortableTime(b.time)
    );

    unloads.sort(
      (a, b) => parseSortableTime(a.time) - parseSortableTime(b.time)
    );

    loads.forEach((stop, index) => {
      output.push(`📦 Загрузка Nr. ${index + 1}: ${stop.plz} ${stop.city}`);

      if (stop.time) output.push(stop.time);

      output.push("");
    });

    unloads.forEach((stop, index) => {
      output.push(`📍 Выгрузка Nr. ${index + 1}: ${stop.plz} ${stop.city}`);

      if (stop.time) output.push(stop.time);

      output.push("");
    });

    return output.join("\n").trim();
  };

  const extractData = (text: string) => {
    if (spedition === "DHL") return extractDHL(text);
    return extractDSV(text);
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

      const items = textContent.items as any[];

      const rows: Record<number, any[]> = {};

      for (const item of items) {
        const y = Math.round(item.transform[5]);

        if (!rows[y]) {
          rows[y] = [];
        }

        rows[y].push(item);
      }

      const pageText = Object.keys(rows)
        .map(Number)
        .sort((a, b) => b - a)
        .map((y) =>
          rows[y]
            .sort((a, b) => a.transform[4] - b.transform[4])
            .map((i) => i.str)
            .join(" ")
        )
        .join("\n");

      fullText += pageText + "\n\n";
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

      if (file) await handleFile(file);
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
  }, [spedition]);

  const copyText = async () => {
    await navigator.clipboard.writeText(result);
    setStatus("Скопировано");
  };

  const buttonStyle = (active: boolean) => ({
    background: active
      ? "linear-gradient(180deg,#4c78ff,#3765ea)"
      : "#f3f3f5",
    color: active ? "#ffffff" : "#1d1d1f",
    padding: "12px 28px",
    borderRadius: 999,
    cursor: "pointer",
    border: active ? "none" : "1px solid #d9d9d9",
    fontSize: 17,
    fontWeight: 400,
    boxShadow: active ? "0 10px 25px rgba(55,101,234,0.25)" : "none",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background: "#f3f3f5",
        padding: 20,
        boxSizing: "border-box",
        fontFamily: '"Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1300,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            textAlign: "center",
            fontSize: "clamp(42px,7vw,82px)",
            fontWeight: 200,
            color: "#1d1d1f",
            marginBottom: 30,
            letterSpacing: "-2px",
          }}
        >
          Tour Data Extractor
        </h1>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 18,
            marginBottom: 30,
            flexWrap: "wrap",
          }}
        >
          <button
            style={buttonStyle(spedition === "DSV")}
            onClick={() => {
              setSpedition("DSV");
              setResult("");
              setStatus("DSV выбран");
            }}
          >
            DSV
          </button>

          <button
            style={buttonStyle(spedition === "DHL")}
            onClick={() => {
              setSpedition("DHL");
              setResult("");
              setStatus("DHL выбран");
            }}
          >
            DHL
          </button>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 40,
            padding: "clamp(20px,4vw,40px)",
            border: "1px solid #e1e1e1",
          }}
        >
          <div
            style={{
              minHeight: 200,
              borderRadius: 30,
              border: "2px dashed #d9d9d9",
              background: "#f3f3f5",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: "clamp(20px,3vw,28px)",
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
              gap: 20,
              flexWrap: "wrap",
              marginTop: 35,
            }}
          >
            <label
              style={{
                background: "linear-gradient(180deg,#4c78ff,#3765ea)",
                color: "#ffffff",
                padding: "18px 34px",
                borderRadius: 999,
                cursor: "pointer",
                fontSize: 18,
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

                  if (file) handleFile(file);
                }}
              />
            </label>

            <button
              onClick={copyText}
              style={{
                background: "linear-gradient(180deg,#4c78ff,#3765ea)",
                color: "#ffffff",
                padding: "18px 34px",
                borderRadius: 999,
                cursor: "pointer",
                border: "none",
                fontSize: 18,
                boxShadow: "0 10px 25px rgba(55,101,234,0.25)",
              }}
            >
              Скопировать текст
            </button>
          </div>

          <div
            style={{
              marginTop: 40,
              background: "#f3f3f5",
              borderRadius: 30,
              padding: 40,
              border: "1px solid #dddddd",
            }}
          >
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: "#1d1d1f",
                fontSize: "clamp(16px,2vw,20px)",
                lineHeight: 2,
                fontFamily: '"Segoe UI", sans-serif',
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