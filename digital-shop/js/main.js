/* kotoha - サイト共通スクリプト */
(function () {
  "use strict";

  /* --- モバイルメニュー開閉 --- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") nav.classList.remove("open");
    });
  }

  /* --- スクロールで要素をふわっと表示 --- */
  var targets = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && targets.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    targets.forEach(function (t) { io.observe(t); });
  } else {
    targets.forEach(function (t) { t.classList.add("in"); });
  }

  /* --- 商品カテゴリーフィルター（shop.html） --- */
  var chips = document.querySelectorAll(".chip[data-filter]");
  var cards = document.querySelectorAll(".product-grid [data-cat]");
  if (chips.length && cards.length) {
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.classList.remove("is-active"); });
        chip.classList.add("is-active");
        var f = chip.getAttribute("data-filter");
        cards.forEach(function (card) {
          var show = f === "all" || card.getAttribute("data-cat") === f;
          card.style.display = show ? "" : "none";
        });
      });
    });
  }

  /* --- お問い合わせフォーム（デモ送信） --- */
  var form = document.querySelector("form[data-demo]");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = form.querySelector(".form-result");
      if (msg) {
        msg.textContent = "送信ありがとうございます！（※これはデモ表示です。実際の送信は行われません）";
        msg.style.display = "block";
      }
      form.reset();
    });
  }

  /* --- フッターの年号を自動更新 --- */
  var y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();
})();
