//---
var audio, audioContext, audioSrc;
var analyser, analyserBufferLength;
//---
var w;
var h;
var center2D;
var btStart;
var canvas;
var context;
var imageData;
var data;
var mouseActive = false;
var mouseDown = false;
var mousePos = { x:0, y:0 };
var fov = 170;
var speed = 1;
var speedMin = speed;
var speedMax = 1;
var particles = [];
var particlesSky = [];
var particleDistanceTop = 12;
//---
function init() {
canvas = document.createElement( 'canvas' );
canvas.addEventListener( 'mousedown', mouseDownHandler, false );
canvas.addEventListener( 'mousemove', mouseMoveHandler, false );
canvas.addEventListener( 'mouseenter', mouseEnterHandler, false );
canvas.addEventListener( 'mouseleave', mouseLeaveHandler, false );
document.body.appendChild( canvas );
context = canvas.getContext( '2d' );
window.addEventListener( 'resize', onResize );
onResize();
addParticles( particles, 1 );
addParticles( particlesSky, -1 );
render();
render();
context.putImageData( imageData, 0, 0 );
btStart = document.getElementById( 'btStartAudioVisualization' );
btStart.addEventListener( 'mousedown', userStart, false );
};
//---
function userStart() {
btStart.removeEventListener( 'mousedown', userStart );
btStart.style.display = 'none';
audioSetup();
animate();
};
//---
function audioSetup() {
audio = new Audio();
audio.src = '/audio//audio/sample.mp3';
audio.controls = false;
audio.loop = true;
audio.autoplay = true;
audio.crossOrigin = 'anonymous';
audioContext = new ( window.AudioContext || window.webkitAudioContext )();
analyser = audioContext.createAnalyser();
analyser.connect( audioContext.destination );
analyser.smoothingTimeConstant = 0.75;
analyser.fftSize = 256 * 32;//circleSegments * 32;
analyserBufferLength = analyser.frequencyBinCount;
audioSrc = audioContext.createMediaElementSource( audio );
audioSrc.connect( analyser );
};
//---
function clearImageData() {
for ( var i = 0, l = data.length; i < l; i += 4 ) {
data[ i ] = 0;
data[ i + 1 ] = 0;
data[ i + 2 ] = 0;
data[ i + 3 ] = 255;
}
};
function setPixel( x, y, r, g, b, a ) {
var i = ( x + y * imageData.width ) * 4;
data[ i ] = r;
data[ i + 1 ] = g;
data[ i + 2 ] = b;
data[ i + 3 ] = a;
};
//---
function drawLine( x1, y1, x2, y2, r, g, b, a ) {
var dx = Math.abs( x2 - x1 );
var dy = Math.abs( y2 - y1 );
var sx = ( x1 < x2 ) ? 1 : -1;
var sy = ( y1 < y2 ) ? 1 : -1;
var err = dx - dy;
var lx = x1;
var ly = y1;
while ( true ) {
if ( lx > 0 && lx < w && ly > 0 && ly < h ) {
setPixel( lx, ly, r, g, b, a );
}
if ( ( lx === x2 ) && ( ly === y2 ) )
break;
var e2 = 2 * err;
if ( e2 > -dx ) {
err -= dy;
lx += sx;
}
if ( e2 < dy ) {
err += dx;
ly += sy;
}
}
};
//---
function addParticle( x, y, z, index ) {
var particle = {};
particle.x = x;
particle.y = y;
particle.z = z;
particle.x2d = 0;
particle.y2d = 0;
particle.index = index;
return particle;
};
function addParticles( array, dir ) {
var audioBufferIndexMin = 8;
var audioBufferIndexMax = 512;
var audioBufferIndex = audioBufferIndexMin;
for ( var z = -fov; z < fov; z += 5 ) {
var particlesRow = [];
for ( var x = -fov; x < fov; x += 5 ) {
var yPos = 0;
if ( dir > 0 ) {
yPos = Math.random() * 5 + particleDistanceTop;
} else {
yPos = Math.random() * 5 - particleDistanceTop;
}
var particle = addParticle( x, yPos, z, audioBufferIndex );
particlesRow.push( particle );
audioBufferIndex++;
if ( audioBufferIndex > audioBufferIndexMax) {
audioBufferIndex = audioBufferIndexMin;
}
}
array.push( particlesRow );
}
};
//---
function onResize(){
w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
h = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
center2D = { x:w / 2, y:h / 2 };
canvas.width = w;
canvas.height = h;
context.fillStyle = '#000000';
context.fillRect( 0, 0, w, h );
imageData = context.getImageData( 0, 0, w, h );
data = imageData.data;
};
//---
function mouseDownHandler( event ) {
if ( audio.paused ) {
audio.play();
} else {
audio.pause();
}
};
function mouseEnterHandler( event ) {
mouseActive = true;
};
function mouseLeaveHandler( event ) {
mouseActive = false;
mousePos.x = w / 2;
mouseDown = false;
};
function mouseMoveHandler( event ) {
mousePos = getMousePos( canvas, event );
};
function getMousePos( canvas, event ) {
var rect = canvas.getBoundingClientRect();
return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};
//---
function render() {
var frequencySource;
if ( analyser ) {
frequencySource = new Uint8Array( analyser.frequencyBinCount );
analyser.getByteFrequencyData( frequencySource );
}
//---
var sortArray = false;
//---
for ( var i = 0, l = particles.length; i < l; i++ ) {
var particlesRow = particles[ i ];
var particlesRowBack;
if ( i > 0 ) {
particlesRowBack = particles[ i - 1 ];
}
for ( var j = 0, k = particlesRow.length; j < k; j++ ) {
var particle = particlesRow[ j ];
var scale = fov / ( fov + particle.z );
particle.x2d = ( particle.x * scale ) + center2D.x;
particle.y2d = ( particle.y * scale ) + center2D.y;
//---
particle.z -= speed;
if ( analyser ) {
var frequency = frequencySource[ particle.index ];
var frequencyAdd = frequency / 10;
particle.y = frequencyAdd + particleDistanceTop;
}
if ( particle.z < -fov ) {
particle.z += ( fov * 2 );
sortArray = true;
}
//---
var lineColorValue;
if ( j > 0 ) {
var p = particlesRow[ j - 1 ];
lineColorValue = Math.round( i / l * 155 );//255
drawLine( particle.x2d | 0, particle.y2d | 0, p.x2d | 0, p.y2d | 0, 0, lineColorValue, 0, 255 );
}
if ( i > 0 && i < l - 1 ) {
var pB = particlesRowBack[ j ];
drawLine( particle.x2d | 0, particle.y2d | 0, pB.x2d | 0, pB.y2d | 0, 0, lineColorValue, 0, 255 );
}
}
}
//---
if ( sortArray ) {
particles = particles.sort( function( a, b ) {
//return ( b[ 0 ].z === a[ 0 ].z ? 0 : ( b[ 0 ].z < a[ 0 ].z ? -1 : 1 ) );
return ( b[ 0 ].z - a[ 0 ].z );
} );
}
//---
for ( var i = 0, l = particlesSky.length; i < l; i++ ) {
var particlesRow = particlesSky[ i ];
var particlesRowBack;
if ( i > 0 ) {
particlesRowBack = particlesSky[ i - 1 ];
}
for ( var j = 0, k = particlesRow.length; j < k; j++ ) {
var particle = particlesRow[ j ];
var scale = fov / ( fov + particle.z );
particle.x2d = ( particle.x * scale ) + center2D.x;
particle.y2d = ( particle.y * scale ) + center2D.y;
//---
particle.z -= speed;
if ( analyser ) {
var frequency = frequencySource[ particle.index ];
var frequencyAdd = frequency / 10;//circle.frequencyFactor;
particle.y = -frequencyAdd - particleDistanceTop;
}
if ( particle.z < -fov ) {
particle.z += ( fov * 2 );
sortArray = true;
}
//---
var lineColorValue;
if ( j > 0 ) {
var p = particlesRow[ j - 1 ];
lineColorValue = Math.round( i / l * 255 );//255
drawLine( particle.x2d | 0, particle.y2d | 0, p.x2d | 0, p.y2d | 0, 0, Math.round( lineColorValue / 2 ), lineColorValue, 255 );
}
if ( i > 0 && i < l - 1 ) {
var pB = particlesRowBack[ j ];
// v1 = { x:particle.x2d | 0, y:particle.y2d | 0 };
// v2 = { x:pB.x2d | 0, y:pB.y2d | 0 };
//var lineColorValue = Math.round( ( ( i - ( fov / 5 ) ) / l ) * 255 );
//drawLine( v1, v2, lineColorValue, lineColorValue, lineColorValue, 255 );
drawLine( particle.x2d | 0, particle.y2d | 0, pB.x2d | 0, pB.y2d | 0, 0, Math.round( lineColorValue / 2 ), lineColorValue, 255 );
}
}
}
//---
if ( sortArray ) {
particlesSky = particlesSky.sort( function( a, b ) {
return ( b[ 0 ].z - a[ 0 ].z );
} );
}
//---
if ( mouseActive ) {
center2D.x += ( canvas.width - mousePos.x - center2D.x ) * 0.0125;
} else {
center2D.x += ( ( canvas.width / 2 ) - center2D.x ) * 0.015;
}
};
//---
function animate() {
clearImageData();
render();
context.putImageData( imageData, 0, 0 );
requestAnimationFrame( animate );
};
window.requestAnimFrame = ( function() {
return  window.requestAnimationFrame       ||
window.webkitRequestAnimationFrame ||
window.mozRequestAnimationFrame    ||
function( callback ) {
window.setTimeout( callback, 1000 / 60 );
};
} )();
//---
init();