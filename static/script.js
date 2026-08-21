function mostrarView(nome, botaoClicado) {
    document.querySelectorAll('.view').forEach(function (view){
        view.classList.remove('view-active');
    });
    document.getElementById('view-' + nome).classList.add('view-active');

    document.querySelectorAll('.nav-item').forEach(function (item) {
        item.classList.remove('active');
    });

    botaoClicado.classList.add('active');
}

document.querySelectorAll('.num-arrow').forEach(function (botao) {
    botao.addEventListener('click', function () {
        var input = botao.closest('.num-wrap').querySelector('input');
        if (botao.classList.contains('up')) {
            input.stepUp();
        } else {
            input.stepDown();
        }
        input.dispatchEvent(new Event('input'));
    });
});

// Grafico de area (Resumo por Despesa): tooltip + crosshair que seguem o
// mouse ate o ponto mais proximo, marcando o valor daquela despesa.
document.querySelectorAll('.chart-wrap').forEach(function (wrap) {
    var dadosAttr = wrap.dataset.pontos;
    if (!dadosAttr) return;

    var pontos = JSON.parse(dadosAttr);
    var svg = wrap.querySelector('.area-chart');
    var crosshair = wrap.querySelector('.chart-crosshair');
    var tooltip = wrap.querySelector('.chart-tooltip');
    var pontosDom = wrap.querySelectorAll('.chart-dot');
    if (!pontos.length || !svg) return;

    var viewBox = svg.viewBox.baseVal;

    function pontoMaisProximo(xView) {
        var indice = 0;
        var menorDist = Infinity;
        pontos.forEach(function (p, i) {
            var dist = Math.abs(p.x - xView);
            if (dist < menorDist) { menorDist = dist; indice = i; }
        });
        return indice;
    }

    function atualizar(clientX) {
        var rect = svg.getBoundingClientRect();
        var xView = ((clientX - rect.left) / rect.width) * viewBox.width;
        var indice = pontoMaisProximo(xView);
        var ponto = pontos[indice];

        var leftPx = (ponto.x / viewBox.width) * rect.width;
        var topPx = (ponto.y / viewBox.height) * rect.height;

        crosshair.style.left = leftPx + 'px';
        crosshair.classList.add('active');

        tooltip.style.left = leftPx + 'px';
        tooltip.style.top = topPx + 'px';
        // Monta via textContent (nao innerHTML) porque ponto.rotulo vem do
        // nome da despesa, digitado pelo usuario -- assim nao da pra injetar
        // HTML/script escrevendo um nome de despesa malicioso.
        tooltip.textContent = '';
        var valorEl = document.createElement('div');
        valorEl.className = 'tt-val';
        valorEl.textContent = 'R$ ' + ponto.valor.toFixed(2).replace('.', ',');
        var labelEl = document.createElement('div');
        labelEl.className = 'tt-label';
        labelEl.textContent = ponto.rotulo;
        tooltip.appendChild(valorEl);
        tooltip.appendChild(labelEl);
        tooltip.classList.add('active');

        pontosDom.forEach(function (dot, i) {
            dot.classList.toggle('active', i === indice);
        });
    }

    function esconder() {
        crosshair.classList.remove('active');
        tooltip.classList.remove('active');
        pontosDom.forEach(function (dot) { dot.classList.remove('active'); });
    }

    wrap.addEventListener('mousemove', function (ev) { atualizar(ev.clientX); });
    wrap.addEventListener('mouseleave', esconder);
});

// Donut (Despesas por Nome): passar o cursor por cima de uma fatia mostra
// o nome daquela despesa (+ valor e %) num tooltip que acompanha o mouse.
document.querySelectorAll('.donut-wrap').forEach(function (wrap) {
    var tooltip = wrap.querySelector('.donut-tooltip');
    var segmentos = wrap.querySelectorAll('.donut-segment');
    if (!tooltip || !segmentos.length) return;

    segmentos.forEach(function (seg) {
        seg.addEventListener('mousemove', function (ev) {
            var rect = wrap.getBoundingClientRect();
            tooltip.style.left = (ev.clientX - rect.left) + 'px';
            tooltip.style.top = (ev.clientY - rect.top) + 'px';

            // textContent, nao innerHTML: nome da despesa vem do usuario.
            tooltip.textContent = '';
            var nomeEl = document.createElement('div');
            nomeEl.className = 'tt-val';
            nomeEl.textContent = seg.dataset.nome;
            var detalheEl = document.createElement('div');
            detalheEl.className = 'tt-label';
            detalheEl.textContent = 'R$ ' + parseFloat(seg.dataset.valor).toFixed(2).replace('.', ',') + ' · ' + seg.dataset.pct + '%';
            tooltip.appendChild(nomeEl);
            tooltip.appendChild(detalheEl);
            tooltip.classList.add('active');
        });
        seg.addEventListener('mouseleave', function () {
            tooltip.classList.remove('active');
        });
    });
});

document.querySelectorAll('.th-sort').forEach(function (th) {
    th.addEventListener('click', function () {
        var tabela = th.closest('table');
        var tbody = tabela.querySelector('tbody');
        var linhas = Array.from(tbody.querySelectorAll('tr')).filter(function (l) {
            return !l.classList.contains('empty-row');
        });
        var col = parseInt(th.dataset.col, 10);
        var tipo = th.dataset.type;
        var asc = th.dataset.asc !== 'true';

        linhas.sort(function (a, b) {
            var va = a.children[col].textContent.trim();
            var vb = b.children[col].textContent.trim();
            if (tipo === 'valor') {
                va = parseFloat(va.replace('R$', '').replace(',', '.'));
                vb = parseFloat(vb.replace('R$', '').replace(',', '.'));
            } else {
                va = parseFloat(va);
                vb = parseFloat(vb);
            }
            return asc ? va - vb : vb - va;
        });

        linhas.forEach(function (linha) { tbody.appendChild(linha); });

        tabela.querySelectorAll('.th-sort').forEach(function (outro) {
            outro.dataset.asc = '';
            outro.querySelectorAll('.sort-arrow').forEach(function (seta) {
                seta.classList.remove('active');
            });
        });

        th.dataset.asc = asc;
        th.querySelector(asc ? '.sort-arrow.up' : '.sort-arrow.down').classList.add('active');
    });
});