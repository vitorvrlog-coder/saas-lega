// Reposiciona o menu "Ações ▾" (details.row-actions > ul) pra
// position:fixed, calculada a partir do botão, toda vez que abre.
// Sem isso, o menu fica position:absolute preso dentro de .table-wrap
// (overflow-x:auto corta/esconde o menu quando a linha está perto do fim
// da tabela — overflow-y computa pra auto junto, mesma caixa de recorte).
(function () {
    function closeAllExcept(except) {
        document.querySelectorAll("details.row-actions[open]").forEach(function (details) {
            if (details !== except) details.removeAttribute("open");
        });
    }

    function positionMenu(details) {
        var summary = details.querySelector("summary");
        var menu = details.querySelector("ul");
        if (!summary || !menu) return;

        var rect = summary.getBoundingClientRect();
        // Medido ANTES de trocar pra position:fixed, enquanto o menu ainda
        // está no fluxo normal (absolute) e encolhe pro conteúdo — o Pico
        // estiliza este <ul> como display:flex, e um flex box fixed com
        // width:auto preenche o viewport inteiro (containing block de
        // position:fixed) em vez de encolher feito um box normal. Sem
        // travar a largura aqui, o menu vira 100% da tela ao abrir.
        var menuWidth = menu.offsetWidth || 250;

        var left = rect.right - menuWidth;
        left = Math.min(left, window.innerWidth - menuWidth - 8);
        left = Math.max(left, 8);

        var top = rect.bottom + 8;
        var maxHeight = Math.min(360, window.innerHeight - top - 16);

        menu.style.position = "fixed";
        menu.style.width = menuWidth + "px";
        menu.style.left = left + "px";
        menu.style.top = top + "px";
        menu.style.right = "auto";
        menu.style.maxHeight = Math.max(maxHeight, 120) + "px";
        // O Pico aplica z-index:99 com !important em details.dropdown[open]
        // > ul — só um !important inline (maior prioridade dentro do mesmo
        // "important tier" de author styles) consegue vencer isso.
        menu.style.setProperty("z-index", "500", "important");
    }

    function closeAll() {
        document.querySelectorAll("details.row-actions[open]").forEach(function (details) {
            details.removeAttribute("open");
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll("details.row-actions").forEach(function (details) {
            details.addEventListener("toggle", function () {
                if (details.open) {
                    closeAllExcept(details);
                    positionMenu(details);
                }
            });
        });

        // Reabrir no mesmo lugar depois de scroll/resize é mais trabalho
        // (e mais frágil) do que vale — fecha e o usuário reabre.
        window.addEventListener("scroll", closeAll, true);
        window.addEventListener("resize", closeAll);
    });
})();
