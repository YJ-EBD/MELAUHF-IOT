// Minimal UI helpers (no framework)
(function () {
  const nowEl = document.getElementById("nowText");
  if (nowEl) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    nowEl.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Sidebar active link based on data-page
  const page = document.body.getAttribute("data-page") || "dashboard";
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.getAttribute("data-nav") === page) a.classList.add("active");
  });

  // Donut chart (UI only)
  const canvas = document.getElementById("donutChart");
  if (canvas && window.Chart) {
    const getNum = (id) => {
      const el = document.getElementById(id);
      if (!el) return 0;
      const m = String(el.textContent).replace(/[^0-9.]/g, "");
      return m ? Number(m) : 0;
    };

    const totalDevices = getNum("metricTotalDevices");
    const expiredDevices = getNum("metricExpiredDevices");
    const todayUsage = getNum("metricTodayUsage");

    new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["전체 기기 개수", "구독이 만료된 기기 수", "오늘 총 사용량"],
        datasets: [{
          data: [totalDevices, expiredDevices, todayUsage],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.label || "";
                const v = ctx.parsed;
                if (label.includes("사용량")) return `${label}: ${v} Wh`;
                return `${label}: ${v}`;
              }
            }
          }
        }
      }
    });
  }
})();
