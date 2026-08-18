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