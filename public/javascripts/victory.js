const RMS = function(ar){
    let L = ar.length;
    return Math.round(Math.sqrt(ar.map((v) => (v**2)).reduce((ac, vl) => (ac + vl))/L)*100)/100;
}
let norml = function(n){return 17-(10*2.14/n)}
function fade(element) {
    var op = 1;
    var timer = setInterval(function () {
        if (op <= 0.05){
            clearInterval(timer);
            element.style.display = 'none';
        }
        element.style.opacity = op;
        element.style.filter = 'alpha(opacity=' + op * 100 + ") blur("+ (8-(op * 8))+"px)";
        op -= op * 0.05;
    }, 75);
}
function victoryMain(){
  let cntnr = document.getElementsByTagName("body")[0];
  {
  let gl = document.createElement('canvas').getContext('webgl')
  let placeholder = document.getElementsByTagName('p')[0]
  placeholder.remove()
  let cnvs = document.getElementsByTagName("canvas")[0];
  let postctx = cntnr.appendChild(document.createElement('canvas')).getContext('2d')
  let postprocess = postctx.canvas;
  let canvas = gl.canvas;
  let stbtn = document.createElement('a')
  stbtn.id = "btStartAudioVisualization";
  stbtn.classList.add('bt')
  stbtn.text = "You Ready?";
  cntnr.appendChild(stbtn);
  // Creating HTMLAudioElement
  let audio = new Audio()

  // Audio Context variables
  let ac, an, sr, spectrumData;

  // Qube size
  let qubeSize = 15;

  let compileShader = function (type, source) {
  	let shader = gl.createShader(type), status;
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    status = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
    if (status) return shader

    console.error('shader compile error', gl.getShaderInfoLog(shader))
  	gl.deleteShader(shader)
  }

  let createProgram = function (vertexShader, fragmentShader) {
  	let program = gl.createProgram(), status
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    status = gl.getProgramParameter(program, gl.LINK_STATUS)
    if (status) return program

    console.error('program link error', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
  }

  let vertexShader = compileShader(gl.VERTEX_SHADER, `
  	attribute vec3 a_pos;
    uniform vec2 u_res;
    uniform float u_frame;
    uniform int u_spectrumValue[128];
    varying float v_frame;
    varying vec3 vv_pos;
    void main () {
    	v_frame = u_frame;
    	float pi = 3.141592653589793;
    	float rad = u_frame / 2.0 / 180.0 * pi;
      int spectrumIndex = 12 + int(mod(a_pos.x + ${Math.floor(qubeSize / 2)}.0, ${qubeSize}.0) + mod(a_pos.y + ${Math.floor(qubeSize / 2)}.0, ${qubeSize ** 2}.0) + (a_pos.z + ${Math.floor(qubeSize / 2)}.0) / ${ qubeSize ** 2}.0);
      float value = float(u_spectrumValue[spectrumIndex]) / 100.0;
    	vec3 v_pos = a_pos;
      vec3 t = vec3(1, 1, 1);

      vv_pos = v_pos;
    	float dist = abs(${Math.floor(qubeSize / 2)}.0 - sqrt(vv_pos.x * vv_pos.x + vv_pos.y * vv_pos.y + vv_pos.z * vv_pos.z));

      t.x = v_pos.x * cos(rad) + v_pos.z * sin(rad);
      t.y = v_pos.y;
      t.z = - v_pos.x * sin(rad) + v_pos.z * cos(rad);

      v_pos = t;


      t.x = v_pos.x * cos(rad) - v_pos.y * sin(rad);
      t.y = v_pos.x * sin(rad) + v_pos.y * cos(rad);
      t.z = v_pos.z;

      v_pos = t;

      t.x = v_pos.x;
      t.y = v_pos.y * cos(rad) - v_pos.z * sin(rad);
      t.z = v_pos.y * sin(rad) + v_pos.z * cos(rad);

      v_pos = t;

      v_pos.z -= 20.0;

      // Make reaction on spectrum
      v_pos.z += value * dist;
      v_pos.y += value / 100.0;

      v_pos.x += sin(u_frame / 30.0 + v_pos.y / 4.0) * 1.2;
      v_pos.y += cos(u_frame / 20.0 + v_pos.z / 5.0) * 1.0;


      v_pos.x /= v_pos.z;
      v_pos.y /= v_pos.z;

      v_pos.x /= u_res.x / u_res.y;

    	gl_Position = vec4(v_pos.xy, 0.0, 1.0);
      gl_PointSize = dist;
    }
  `)

  let fragmentShader = compileShader(gl.FRAGMENT_SHADER, `
  	precision mediump float;
    uniform vec4 u_color;
    varying float v_frame;
    varying vec3 vv_pos;
    float hue2rgb(float f1, float f2, float hue) {
        if (hue < 0.0)
            hue += 1.0;
        else if (hue > 1.0)
            hue -= 1.0;
        float res;
        if ((6.0 * hue) < 1.0)
            res = f1 + (f2 - f1) * 6.0 * hue;
        else if ((2.0 * hue) < 1.0)
            res = f2;
        else if ((3.0 * hue) < 2.0)
            res = f1 + (f2 - f1) * ((2.0 / 3.0) - hue) * 6.0;
        else
            res = f1;
        return res;
    }

    vec3 hsl2rgb(vec3 hsl) {
        vec3 rgb;

        if (hsl.y == 0.0) {
            rgb = vec3(hsl.z); // Luminance
        } else {
            float f2;

            if (hsl.z < 0.5)
                f2 = hsl.z * (1.0 + hsl.y);
            else
                f2 = hsl.z + hsl.y - hsl.y * hsl.z;

            float f1 = 2.0 * hsl.z - f2;

            rgb.r = hue2rgb(f1, f2, hsl.x + (1.0/3.0));
            rgb.g = hue2rgb(f1, f2, hsl.x);
            rgb.b = hue2rgb(f1, f2, hsl.x - (1.0/3.0));
        }
        return rgb;
    }

    vec3 hsl2rgb(float h, float s, float l) {
        return hsl2rgb(vec3(h, s, l));
    }
    void main () {
    	float dist = sqrt(vv_pos.x * vv_pos.x + vv_pos.y * vv_pos.y + vv_pos.z * vv_pos.z);
      float i_frame = mod(v_frame + dist * 20.0, 360.0);
    	gl_FragColor = vec4(hsl2rgb((i_frame) / 360.0, 1.0, .5), 1.0);
    }
  `)

  let program = createProgram(vertexShader, fragmentShader)

  let aPosition = gl.getAttribLocation(program, 'a_pos')
  let uResolution = gl.getUniformLocation(program, 'u_res')
  let uFrame = gl.getUniformLocation(program, 'u_frame')
  let uSpectrumValue = gl.getUniformLocation(program, 'u_spectrumValue')

  let vertices = []
  let vertexBuffer = gl.createBuffer()
  let frame = 0
  let render = () => {
  	frame++


    if (an) {
      an.getByteFrequencyData(spectrumData)
      // if (0===frame%20){console.log(RMS(spectrumData))}
      // Transfer spectrum data to shader program
      gl.uniform1iv(uSpectrumValue, spectrumData)
    }

    // Resizing
    if (postprocess.width !== postprocess.offsetWidth || postprocess.height !== postprocess.offsetHeight) {
        postprocess.width = postprocess.offsetWidth
        postprocess.height = postprocess.offsetHeight
        canvas.width = postprocess.width
        canvas.height = postprocess.height
  			gl.uniform2fv(uResolution, [canvas.width, canvas.height])
        gl.viewport(0, 0, canvas.width, canvas.height)
    }
    gl.uniform1f(uFrame, frame)
    gl.clear(gl.COLOR_BUFFER_BIT)
  	gl.drawArrays(gl.POINTS, 0, vertices.length / 3)

    // Make Bloom
    postctx.globalAlpha = frame ? 0.2 : 1 // This is for correct preview image
    postctx.drawImage(canvas, 0, 0)
    postctx.filter = "blur(4px)"
    postctx.globalCompositeOperation = "screen"
    postctx.drawImage(canvas, 0, 0)
    postctx.globalCompositeOperation = "source-over"
    postctx.filter = "blur(0)"

    requestAnimationFrame(render)
    let padScale = norml(RMS(spectrumData))
    let bodyScale = 100-(padScale*2)
    cnvs.style.padding = `${padScale}%`
    cnvs.style.width = cntnr.style.height = `${bodyScale}%`
  }

  gl.clearColor(0,0,0,1)
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.useProgram(program)
  gl.uniform2fv(uResolution, new Float32Array([canvas.width, canvas.height]))


  for (let i = 0; i < qubeSize ** 3; i++) {
    let x = (i % qubeSize)
    let y = Math.floor(i / qubeSize) % qubeSize
    let z = Math.floor(i / qubeSize ** 2)
    x -= qubeSize / 2 - 0.5
    y -= qubeSize / 2 - 0.5
    z -= qubeSize / 2 - 0.5

    let pos = [x, y, z]

    vertices.push(x)
    vertices.push(y)
    vertices.push(z)
  }
  gl.enableVertexAttribArray(aPosition)
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)



btStart = document.getElementById( 'btStartAudioVisualization' );
btStart.addEventListener( 'mousedown', userStart, { once: true });
function userStart() {
  btStart.removeEventListener( 'mousedown', userStart );
  setTimeout(()=>{
    btStart.classList.add("clicked")
    btStart.text = "Enjoy! 😎"
  fade(btStart)
  audio.src = "/audio/swag.mp3"
      audio.oncanplay = () => {
        ac = new AudioContext()
        an = ac.createAnalyser()
        sr = ac.createMediaElementSource(audio)
        spectrumData = new Uint8Array(an.frequencyBinCount)
        an.smoothingTimeConstant = 0.2
        an.fftSize = 128
        sr.connect(an)
        an.connect(ac.destination)
        audio.loop = true;
        audio.play()
      }
  render()
}, 250);
  }
  };
}

window.addEventListener("load", (ev)=>{victoryMain()})