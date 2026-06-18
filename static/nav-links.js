(() => {
  const appendTopLinks = async () => {
    const nav = document.querySelector(".topnav");
    if (!nav || nav.dataset.runtimeLinks === "loaded") return;
    const beforeNode = nav.querySelector(".github-link");
    if (!nav.querySelector(".recover-link")) {
      const recoverLink = document.createElement("a");
      recoverLink.className = "recover-link";
      recoverLink.href = "/recover.html";
      recoverLink.textContent = "找回工作区";
      nav.insertBefore(recoverLink, beforeNode);
    }
    try {
      const response = await fetch("/public-config", { cache: "no-store" });
      if (!response.ok) return;
      const config = await response.json();
      const links = Array.isArray(config.top_links) ? config.top_links : [];
      links
        .filter((item) => item && item.url && item.label)
        .forEach((item) => {
          const link = document.createElement("a");
          link.className = "runtime-top-link";
          link.href = item.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = item.label;
          nav.insertBefore(link, beforeNode);
        });
      nav.dataset.runtimeLinks = "loaded";
    } catch {
      // Public links are optional; keep the page usable if config cannot load.
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", appendTopLinks, { once: true });
  } else {
    appendTopLinks();
  }
})();
