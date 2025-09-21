var express = require('express');
var router = express.Router();

/* GET soundscape. */
router.get('/', function(req, res, next) {
  res.render('soundscape', { title: 'Soundscape' });
});

module.exports = router;
