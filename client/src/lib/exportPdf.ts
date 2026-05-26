import type { Balloon, Session } from "@shared/schema";

// Export the PDF with balloon overlays drawn on each page using Canvas + jsPDF
export async function exportMarkedPdf(
  session: Session,
  balloons: Balloon[],
  pdfDoc: any // pdfjsLib document
) {
  const { jsPDF } = await import("jspdf");

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm" });
  let firstPage = true;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // high res

    // Render page to canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Draw balloon markers on canvas
    const pageBalloons = balloons.filter((b) => b.pageNumber === pageNum);
    pageBalloons.forEach((b) => {
      const x = (b.xPercent / 100) * viewport.width;
      const y = (b.yPercent / 100) * viewport.height;
      const r = 20;

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = b.rowType === "NOTE" ? "#d97706" : "#1e64c8";
      ctx.lineWidth = 2.5;
      ctx.fillStyle = b.rowType === "NOTE" ? "rgba(217,119,6,0.15)" : "rgba(30,100,200,0.15)";
      ctx.fill();
      ctx.stroke();

      // Text
      ctx.fillStyle = b.rowType === "NOTE" ? "#92400e" : "#0a3d8f";
      ctx.font = `bold ${r}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = b.balloonNumber.length > 4 ? b.balloonNumber.substring(0, 4) : b.balloonNumber;
      ctx.fillText(label, x, y);
    });

    // Add page to PDF
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    // Fit to A3 landscape page proportionally
    const pdfW = 420; // A3 width mm
    const pdfH = (viewport.height / viewport.width) * pdfW;

    if (!firstPage) {
      pdf.addPage([pdfW, pdfH], "landscape");
    } else {
      pdf.deletePage(1);
      pdf.addPage([pdfW, pdfH], "landscape");
      firstPage = false;
    }

    pdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);

    // Add page label
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text(
      `HCS FAI — ${session.partNumber || session.name} — Page ${pageNum}/${pdfDoc.numPages}`,
      4,
      pdfH - 3
    );
  }

  pdf.save(`HCS_FAI_${session.partNumber || session.name}_Bubbled_Drawing.pdf`);
}
