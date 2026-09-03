export async function downloadElementPdf(element: HTMLElement, filename: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  document.body.classList.add("is-exporting");
  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#f3f6fb",
      windowWidth: Math.max(element.scrollWidth, 1480),
    });

    const image = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
      unit: "pt",
      format: "a4",
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 18;
    const usableWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;
    const sliceHeight = Math.max(1, pageHeight - margin * 2);
    let offset = 0;
    let page = 0;

    while (offset < imgHeight && page < 20) {
      if (offset > 0) pdf.addPage();
      pdf.addImage(image, "PNG", margin, margin - offset, usableWidth, imgHeight);
      offset += sliceHeight;
      page += 1;
    }

    pdf.save(filename);
  } finally {
    document.body.classList.remove("is-exporting");
  }
}
