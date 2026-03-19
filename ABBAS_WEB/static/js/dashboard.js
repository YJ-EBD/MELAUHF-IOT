(function () {
  if (!window.Chart) return;

  function readPalette() {
    const css = getComputedStyle(document.documentElement);
    const isDark = (document.documentElement.getAttribute("data-bs-theme") || "light") === "dark";
    return {
      primary: css.getPropertyValue("--bs-primary").trim() || "#0d6efd",
      success: css.getPropertyValue("--bs-success").trim() || "#198754",
      danger: css.getPropertyValue("--bs-danger").trim() || "#dc3545",
      warning: css.getPropertyValue("--bs-warning").trim() || "#ffc107",
      secondary: css.getPropertyValue("--bs-secondary").trim() || "#6c757d",
      bodyColor: css.getPropertyValue("--bs-body-color").trim() || "#212529",
      secondaryColor: css.getPropertyValue("--bs-secondary-color").trim() || "#6c757d",
      remainderColor: isDark ? "rgba(148,163,184,0.22)" : "rgba(108,117,125,0.18)",
    };
  }

  const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart, args, opts) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data.length) return;

      const x = (chartArea.left + chartArea.right) / 2;
      const y = (chartArea.top + chartArea.bottom) / 2;

      const valueText = opts?.valueText ?? "";
      const labelText = opts?.labelText ?? "";
      const palette = readPalette();

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // value
      ctx.fillStyle = palette.bodyColor;
      ctx.font = "600 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(valueText, x, y - 6);

      // label
      ctx.fillStyle = palette.secondaryColor;
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(labelText, x, y + 14);

      ctx.restore();
    },
  };

  Chart.register(centerTextPlugin);

  function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  const charts = [];

  function applyThemeToChart(chart) {
    if (!chart || !chart.data || !chart.data.datasets || !chart.data.datasets.length) return;
    const palette = readPalette();
    const colorKey = chart.canvas.dataset.color || "primary";
    const accent = palette[colorKey] || palette.primary;
    chart.data.datasets[0].backgroundColor = [accent, palette.remainderColor];
    chart.update("none");
  }

  let refreshQueued = false;
  function refreshChartsForTheme() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(() => {
      charts.forEach((chart) => applyThemeToChart(chart));
      refreshQueued = false;
    });
  }

  const canvases = document.querySelectorAll(".donut-canvas");
  canvases.forEach((canvas) => {
    const value = toNumber(canvas.dataset.value);
    const max = Math.max(toNumber(canvas.dataset.max) || 1, 1);
    const unit = canvas.dataset.unit || "";
    const label = canvas.dataset.label || "";
    const palette = readPalette();
    const colorKey = canvas.dataset.color || "primary";
    const accent = palette[colorKey] || palette.primary;

    const remainder = Math.max(max - value, 0);

    // value가 0이고 remainder도 0인 경우(비정상) 대비
    const safeValue = (value === 0 && remainder === 0) ? 1 : value;

    const chart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["값", "잔여"],
        datasets: [
          {
            data: remainder > 0 ? [value, remainder] : [safeValue, 0],
            backgroundColor: [accent, palette.remainderColor],
            borderWidth: 0,
            hoverOffset: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "76%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.dataIndex === 0) return `${label}: ${value} ${unit}`.trim();
                return "잔여";
              },
            },
          },
          centerText: {
            valueText: `${value} ${unit}`.trim(),
            labelText: label,
          },
        },
      },
    });

    charts.push(chart);
  });

  window.addEventListener("app:themechange", refreshChartsForTheme);

  const themeObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === "attributes" && mutation.attributeName === "data-bs-theme")) {
      refreshChartsForTheme();
    }
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-bs-theme"],
  });
})();
