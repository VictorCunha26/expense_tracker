/*
 * "SYNCH" / "CASH" em 3D de verdade -- texto extrudado (Three.js
 * TextGeometry), acabamento metalico em cinza/branco (tema P&B),
 * igual o "S" que tinha antes: mesmo material, mesma luz, mesmo
 * ciclo de materializar/desmaterializar (agora em loop continuo,
 * nao so no hover).
 *
 * Modulo ES porque a partir do three.js r150+ o build classico
 * (three.min.js) nao inclui mais FontLoader/TextGeometry -- so
 * existem como addon ES module. Por isso o <script type="importmap">
 * no <head> do login.html/cadastro.html mapeando "three" e
 * "three/addons/" pro CDN.
 *
 * Progressive enhancement: qualquer falha (CDN fora do ar, fonte
 * nao carrega, sem WebGL) cai pro <div class="auth-watermark-fallback">
 * que ja esta no HTML, com a mesma animacao soh que em CSS puro.
 */
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

(function () {
  var stage = document.getElementById('text3dStage');
  if (!stage) return;

  var fallback = stage.querySelector('.auth-watermark-fallback');

  function smoothstep(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  }

  // espelha o keyframe CSS auth-materialize-3d: sobe ate 30%, segura
  // ate 70%, desce ate 100% -- so que dirigido pelo tempo, em loop.
  function easeCycle(localT) {
    if (localT < 0.3) return smoothstep(localT / 0.3);
    if (localT < 0.7) return 1;
    return smoothstep(1 - (localT - 0.7) / 0.3);
  }

  try {
    var width = stage.clientWidth || 640;
    var height = stage.clientHeight || 420;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0, 7.2);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    stage.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2.5, 3, 4);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(-3, -2, -3);
    scene.add(rim);

    var fitGroup = null; // vira o group depois que build() roda
    var fitLine = null;  // guarda a largura bruta do texto pra reajustar

    // preenche a largura visivel da camera (frustum), nao um numero
    // fixo -- assim o texto sempre cabe no palco, seja qual for o
    // tamanho da tela, sem estourar as bordas nem sobrar vazio
    function fitToFrustum() {
      var vFov = camera.fov * Math.PI / 180;
      var frustumHeight = 2 * Math.tan(vFov / 2) * camera.position.z;
      var frustumWidth = frustumHeight * camera.aspect;
      return (frustumWidth * 0.78) / fitLine.width;
    }

    function resize() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (fitGroup) fitGroup.scale.setScalar(fitToFrustum());
    }
    window.addEventListener('resize', resize);

    var loader = new FontLoader();
    loader.load(
      'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
      function (font) { build(font); },
      undefined,
      function (err) {
        console.warn('Fonte 3D nao carregou, usando texto plano.', err);
      }
    );

    function makeLine(font, text, size) {
      var geo = new TextGeometry(text, {
        font: font,
        size: size,
        height: size * 0.32,
        curveSegments: 6,
        bevelEnabled: true,
        bevelThickness: size * 0.025,
        bevelSize: size * 0.012,
        bevelSegments: 2
      });
      geo.computeBoundingBox();
      var bb = geo.boundingBox;
      var w = bb.max.x - bb.min.x;
      var h = bb.max.y - bb.min.y;
      geo.translate(-(bb.min.x + w / 2), -(bb.min.y + h / 2), -size * 0.16);
      return { geo: geo, width: w, height: h };
    }

    function makeMaterials() {
      return {
        solid: new THREE.MeshStandardMaterial({
          color: 0xf3f3f5, metalness: 0.55, roughness: 0.3,
          transparent: true, opacity: 0, depthWrite: false
        }),
        wire: new THREE.MeshBasicMaterial({
          color: 0xffffff, wireframe: true,
          transparent: true, opacity: 0, depthWrite: false
        })
      };
    }

    function build(font) {
      // "SYNCH CASH" numa linha so, o maior que da pro palco aguentar
      var fontSize = 1.15;
      var line = makeLine(font, 'SYNCH CASH', fontSize);

      var group = new THREE.Group();
      var mat = makeMaterials();
      var mesh = new THREE.Mesh(line.geo, mat.solid);
      var wire = new THREE.Mesh(line.geo, mat.wire);
      wire.scale.setScalar(1.012);
      group.add(mesh, wire);

      // auto-ajusta o tamanho pra ocupar quase toda a largura visivel
      // da camera, seja qual for a metrica exata da fonte carregada
      // ou o tamanho real do palco
      fitLine = line;
      fitGroup = group;
      group.scale.setScalar(fitToFrustum());
      scene.add(group);

      // tudo certo -- some com o texto plano de fallback
      if (fallback) fallback.style.display = 'none';

      var clock = new THREE.Clock();
      var duration = 6;

      function tick() {
        var t = clock.getElapsedTime();
        var localT = (t % duration) / duration;
        var ease = easeCycle(localT);

        mat.solid.opacity = 0.95 * ease;
        mat.wire.opacity = 0.08 * ease;
        var s = 0.93 + 0.07 * ease;
        mesh.scale.setScalar(s);
        wire.scale.setScalar(s * 1.012);

        // giro suave, sem virar cambalhota -- continua legivel
        group.rotation.y = Math.sin(t * 0.35) * 0.13;
        group.rotation.x = Math.sin(t * 0.5 + 1) * 0.045;

        renderer.render(scene, camera);
        requestAnimationFrame(tick);
      }
      tick();
    }
  } catch (err) {
    // Sem WebGL/Three disponivel -- mantem o texto plano do HTML.
    console.warn('Texto 3D indisponivel, usando fallback.', err);
  }
})();
