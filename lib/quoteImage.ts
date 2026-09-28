export type ShareDatum = { label: string; value: string; note?: string };
export type ShareImage = {
  quote: string;
  author: string;
  source: string;
  locator: string;
  url: string;
  date: string;
  stage: string;
  data: ShareDatum[];
};

function lines(ctx: CanvasRenderingContext2D, content: string, width: number): string[] {
  const result: string[] = [];
  let line = "";
  for (const char of content) {
    if (ctx.measureText(line + char).width > width && line) {
      result.push(line);
      line = char;
    } else line += char;
  }
  if (line) result.push(line);
  return result;
}

export function saveQuotePng(card: ShareImage): void {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器未提供图片绘制功能");
  // Fixed pixel dimensions make the exported image readable in chat apps.
  const width = 1080, pad = 76, inner = width - pad * 2;
  ctx.font = '48px "KaiTi", "STKaiti", "Kaiti SC", serif';
  const quoteLines = lines(ctx, `“${card.quote}”`, inner);
  ctx.font = '23px "Noto Sans CJK SC", "PingFang SC", sans-serif';
  const sourceLines = lines(ctx, `出处：${card.source} · ${card.locator}`, inner);
  const urlLines = lines(ctx, card.url, inner);
  const sourceHeight = sourceLines.length * 35 + urlLines.length * 32;
  const quoteHeight = quoteLines.length * 79;
  const gridTop = 230 + quoteHeight + 82 + sourceHeight + 104;
  const rowHeight = 132;
  const height = gridTop + rowHeight * 3 + 108;
  canvas.width = width;
  canvas.height = height;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#153e3b");
  gradient.addColorStop(1, "#0a2029");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#6fae9d";
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, width - 48, height - 48);
  ctx.textBaseline = "top";

  ctx.fillStyle = "#a5e0ce";
  ctx.font = '27px "PingFang SC", sans-serif';
  ctx.fillText("大A观测助手 · 今日投资观点", pad, 77);
  ctx.fillStyle = "#ffffff";
  ctx.font = '48px "KaiTi", "STKaiti", "Kaiti SC", serif';
  quoteLines.forEach((line, index) => ctx.fillText(line, pad, 176 + index * 79));
  const authorY = 196 + quoteHeight;
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillStyle = "#d5f1e4";
  ctx.textAlign = "right";
  ctx.fillText(`—— ${card.author}`, width - pad, authorY);
  ctx.textAlign = "left";
  const sourceY = authorY + 66;
  ctx.strokeStyle = "#52776f";
  ctx.beginPath();ctx.moveTo(pad, sourceY - 18);ctx.lineTo(width - pad, sourceY - 18);ctx.stroke();
  ctx.fillStyle = "#e0efe9";
  ctx.font = '23px "Noto Sans CJK SC", "PingFang SC", sans-serif';
  sourceLines.forEach((line, index) => ctx.fillText(line, pad, sourceY + index * 35));
  ctx.font = '20px Arial, sans-serif';
  ctx.fillStyle = "#a3c9bd";
  urlLines.forEach((line, index) => ctx.fillText(line, pad, sourceY + sourceLines.length * 35 + index * 32));
  ctx.font = '21px "PingFang SC", sans-serif';
  ctx.fillText("据原文意译或归纳", pad, sourceY + sourceHeight + 13);

  ctx.strokeStyle = "#52776f";
  ctx.beginPath();ctx.moveTo(pad, gridTop - 31);ctx.lineTo(width - pad, gridTop - 31);ctx.stroke();
  ctx.fillStyle = "#a5e0ce";
  ctx.font = '25px "PingFang SC", sans-serif';
  ctx.fillText(`市场数据 · ${card.date} · ${card.stage}`, pad, gridTop);
  card.data.forEach((entry, index) => {
    const col = index % 2, row = Math.floor(index / 2);
    const x = pad + col * (inner / 2), y = gridTop + 69 + row * rowHeight;
    ctx.fillStyle = "#a9c8be";
    ctx.font = '23px "PingFang SC", sans-serif';
    ctx.fillText(entry.label, x, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = 'bold 35px "PingFang SC", sans-serif';
    ctx.fillText(entry.value, x, y + 31);
    if (entry.note) {
      ctx.fillStyle = "#95bdb0";
      ctx.font = '19px "PingFang SC", sans-serif';
      ctx.fillText(entry.note, x, y + 81);
    }
  });
  ctx.fillStyle = "#a5cbbd";
  ctx.font = "22px Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("powered by C.Luo w/ChatGPT", width - pad, height - 78);

  const anchor = document.createElement("a");
  anchor.href = canvas.toDataURL("image/png");
  anchor.download = `大A观测助手_投资观点_${card.date}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
