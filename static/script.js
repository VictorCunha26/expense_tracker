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