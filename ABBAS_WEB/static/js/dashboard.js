(function () {
  if (!window.Chart) return;

  const DONUT_SEGMENT_WEIGHTS = [18, 22, 20, 24, 16];
  const DONUT_SEGMENT_COLORS = [
    "#ff7f8f",
    "#2de2c6",
    "#5b80ff",
    "#8c67ff",
    "#39c9ff",
  ];

  function readPalette() {
    const isDark = (document.documentElement.getAttribute("data-bs-theme") || "light") === "dark";
    return {
      donutTextColor: isDark ? "#f6f7ff" : "#1a2340",
      donutSubtextColor: isDark ? "rgba(199, 205, 255, 0.72)" : "rgba(74, 86, 122, 0.78)",
      trackColor: isDark ? "rgba(98, 113, 176, 0.24)" : "rgba(136, 151, 204, 0.22)",
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
      ctx.fillStyle = palette.donutTextColor;
      ctx.font = "700 18px Inter, Noto Sans KR, sans-serif";
      ctx.fillText(valueText, x, y - 6);

      // label
      ctx.fillStyle = palette.donutSubtextColor;
      ctx.font = "12px Inter, Noto Sans KR, sans-serif";
      ctx.fillText(labelText, x, y + 14);

      ctx.restore();
    },
  };

  Chart.register(centerTextPlugin);

  function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function buildSegmentedDataset(value, max) {
    const palette = readPalette();
    const totalWeight = DONUT_SEGMENT_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    const ratio = clamp(max > 0 ? value / max : 0, 0, 1);
    let remainingFill = totalWeight * ratio;
    const data = [];
    const backgroundColor = [];

    DONUT_SEGMENT_WEIGHTS.forEach((weight, index) => {
      const fill = clamp(remainingFill, 0, weight);
      const empty = Math.max(weight - fill, 0);
      const segmentColor = DONUT_SEGMENT_COLORS[index % DONUT_SEGMENT_COLORS.length];

      if (fill > 0.001) {
        data.push(fill);
        backgroundColor.push(segmentColor);
      }
      if (empty > 0.001) {
        data.push(empty);
        backgroundColor.push(palette.trackColor);
      }

      remainingFill = Math.max(remainingFill - weight, 0);
    });

    if (!data.length) {
      return {
        data: [totalWeight],
        backgroundColor: [palette.trackColor],
      };
    }

    return {
      data,
      backgroundColor,
    };
  }

  const charts = [];

  function applyThemeToChart(chart) {
    if (!chart || !chart.data || !chart.data.datasets || !chart.data.datasets.length) return;
    const value = toNumber(chart.canvas.dataset.value);
    const max = Math.max(toNumber(chart.canvas.dataset.max) || 1, 1);
    const segmented = buildSegmentedDataset(value, max);
    chart.data.labels = segmented.data.map(function (_, index) {
      return "segment-" + index;
    });
    chart.data.datasets[0].data = segmented.data;
    chart.data.datasets[0].backgroundColor = segmented.backgroundColor;
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
    const segmented = buildSegmentedDataset(value, max);

    const chart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: segmented.data.map(function (_, index) {
          return "segment-" + index;
        }),
        datasets: [
          {
            data: segmented.data,
            backgroundColor: segmented.backgroundColor,
            borderWidth: 0,
            hoverOffset: 0,
            spacing: 4,
            borderRadius: 999,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        rotation: -0.92 * Math.PI,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
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
