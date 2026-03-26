import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { freezeComputedStylesForSnapshot } from "@/lib/snapshot-inline-styles";

/**
 * Rasterizes a DOM subtree to a multi-page A4 PDF.
 *
 * html2canvas reads `getComputedStyle()` for every node. Tailwind v4 uses
 * `lab()` etc., so we inline the full computed style map on the live subtree,
 * then render a **deep clone inside an empty iframe** (no app CSS). That way
 * `getComputedStyle` during capture only sees rgb/hex + UA defaults.
 */
export async function captureHtmlToPdfSnapshot(
  element: HTMLElement,
  filename: string
): Promise<void> {
  await document.fonts.ready;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const restoreStyles = freezeComputedStylesForSnapshot(element);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;left:-9999px;top:0;width:900px;height:16000px;border:0;opacity:0;pointer-events:none;visibility:hidden;";

  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;background:#f6f3ee"></body></html>'
    );
    doc.close();

    document.querySelectorAll("style").forEach((s) => {
      const t = s.textContent ?? "";
      if (/@font-face/i.test(t)) {
        doc.head.appendChild(s.cloneNode(true));
      }
    });

    const clone = element.cloneNode(true) as HTMLElement;
    doc.body.appendChild(clone);

    const canvas = await html2canvas(clone, {
      scale: 2,
      backgroundColor: "#f6f3ee",
      logging: false,
      useCORS: true,
      windowWidth: clone.scrollWidth,
      windowHeight: clone.scrollHeight,
    });

    const imgData = canvas.toDataURL("image/png", 0.92);
    const pdf = new jsPDF({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    pdf.save(filename);
  } finally {
    restoreStyles();
    iframe.remove();
  }
}
