import Ember from "ember";
import Target from "../system/target";
import Rectangle from "../system/rectangle";
import w from "../computed/w";

const computed = Ember.computed;
const on = Ember.on;
const observer = Ember.observer;
const beforeObserver = Ember.beforeObserver;

const bind = Ember.run.bind;
const scheduleOnce = Ember.run.scheduleOnce;
const next = Ember.run.next;
const cancel = Ember.run.cancel;

const get = Ember.get;
const set = Ember.set;
const fmt = Ember.String.fmt;

const alias = Ember.computed.alias;
const bool = Ember.computed.bool;
const filterBy = Ember.computed.filterBy;

const addObserver = Ember.addObserver;
const removeObserver = Ember.removeObserver;

const RSVP = Ember.RSVP;

const isSimpleClick = Ember.ViewUtils.isSimpleClick;
const $ = Ember.$;

export default Ember.Component.extend({

  isVisible: false,

  classNames: ['popup-menu'],

  classNameBindings: ['orientationClassName', 'pointerClassName'],

  orientationClassName: computed('orientation', function () {
    var orientation = get(this, 'orientation');
    return orientation ? fmt('orient-%@', [orientation]) : null;
  }),

  pointerClassName: computed('pointer', function () {
    var pointer = get(this, 'pointer');
    return pointer ? fmt('pointer-%@', [pointer]) : null;
  }),

  disabled: false,

  orientation: null,

  pointer: null,

  flow: 'around',

  /**
    The target element of the popup menu.
    Can be a view, id, or element.
   */
  for: null,

  on: null,

  addTarget: function (target, options) {
    get(this, 'targets').pushObject(Target.create(options, {
      component: this,
      target: target
    }));
  },

  targets: computed(function() {
    return Ember.A();
  }),

  /**
    Property that notifies the popup menu to retile
   */
  'will-change': alias('willChange'),
  willChange: w(),

  willChangeWillChange: beforeObserver('willChange', function() {
    get(this, 'willChange').forEach(function (key) {
      removeObserver(this, key, this, 'retile');
    }, this);
  }),

  willChangeDidChange: on('init', observer('willChange', function () {
    get(this, 'willChange').forEach(function (key) {
      addObserver(this, key, this, 'retile');
    }, this);
    this.retile();
  })),

  // ..............................................
  // Event management
  //

  attachWindowEvents: on('didInsertElement', function () {
    this.retile();

    var retile = this.__retile = bind(this, 'retile');
    ['scroll', 'resize'].forEach(function (event) {
      $(window).on(event, retile);
    });

    addObserver(this, 'isVisible', this, 'retile');
  }),

  attachTargets: on('didInsertElement', function () {
    // Add implicit target
    if (get(this, 'for') && get(this, 'on')) {
      this.addTarget(get(this, 'for'), {
        on: get(this, 'on')
      });
    }

    next(this, function () {
      get(this, 'targets').invoke('attach');
    });
  }),

  removeEvents: on('willDestroyElement', function () {
    get(this, 'targets').invoke('detach');

    var retile = this.__retile;
    ['scroll', 'resize'].forEach(function (event) {
      $(window).off(event, retile);
    });

    if (this.__documentClick) {
      $(document).off('mousedown', this.__documentClick);
      this.__documentClick = null;
    }

    removeObserver(this, 'isVisible', this, 'retile');
    this.__retile = null;
  }),

  mouseEnter: function () {
    if (get(this, 'disabled')) { return; }
    set(this, 'hovered', true);
  },

  mouseLeave: function () {
    if (get(this, 'disabled')) { return; }
    set(this, 'hovered', false);
    get(this, 'targets').setEach('hovered', false);
  },

  mouseDown: function () {
    if (get(this, 'disabled')) { return; }
    set(this, 'active', true);
  },

  mouseUp: function () {
    if (get(this, 'disabled')) { return; }
    set(this, 'active', false);
  },

  documentClick: function (evt) {
    if (get(this, 'disabled')) { return; }

    set(this, 'active', false);
    var targets = get(this, 'targets');
    var element = get(this, 'element');
    var clicked = isSimpleClick(evt) &&
      (evt.target === element || $.contains(element, evt.target));
    var clickedAnyTarget = targets.any(function (target) {
      return target.isClicked(evt);
    });

    if (!clicked && !clickedAnyTarget) {
      targets.setEach('active', false);
    }
  },

  isActive: bool('activeTargets.length'),

  activeTargets: filterBy('targets', 'isActive', true),

  activeTarget: computed('activeTargets.[]', function () {
    if (get(this, 'isActive')) {
      return get(this, 'targets').findBy('anchor', true) ||
             get(this, 'activeTargets.firstObject');
    }
    return null;
  }),

  activate: function (target) {
    get(this, 'targets').findBy('target', target).set('isActive', true);
  },

  deactivate: function (target) {
    if (target == null) {
      get(this, 'targets').setEach('isActive', false);
    } else {
      get(this, 'targets').findBy('target', target).set('isActive', false);
    }
  },

  /**
    Before the menu is shown, setup click events
    to catch when the user clicks outside the
    menu.
   */
  visibilityDidChange: on('init', observer('isActive', function () {
    var component = this;

    if (this._animation) {
      this._animation.then(function () {
        component.visibilityDidChange();
      });
    }

    scheduleOnce('afterRender', this, 'animateMenu');
  })),

  animateMenu: function () {
    var component = this;
    var proxy = this.__documentClick = this.__documentClick || bind(this, 'documentClick');
    var animation = get(this, 'animation');

    var isActive = get(this, 'isActive');
    var isInactive = !isActive;
    var isVisible = get(this, 'isVisible');
    var isHidden = !isVisible;

    if (isActive && isHidden) {
      this._animation = this.show(animation).then(function () {
        $(document).on('mousedown', proxy);
        component._animation = null;
      });

    // Remove click events immediately
    } else if (isInactive && isVisible) {
      $(document).off('mousedown', proxy);
      this._animation = this.hide(animation).then(function () {
        component._animation = null;
      });
    }
  },

  hide: function (animationName) {
    var deferred = RSVP.defer();
    var component = this;
    var animation = this.container.lookup('popup-animation:' + animationName);
    this._hider = next(this, function () {
      if (this.isDestroyed) { return; }

      if (animation) {
        var promise = animation.out.call(this);
        promise.then(function () {
          set(component, 'isVisible', false);
        });
        deferred.resolve(promise);
      } else {
        set(component, 'isVisible', false);
        deferred.resolve();
      }
    });
    return deferred.promise;
  },

  show: function (animationName) {
    cancel(this._hider);

    var deferred = RSVP.defer();
    var animation = this.container.lookup('popup-animation:' + animationName);
    set(this, 'isVisible', true);
    scheduleOnce('afterRender', this, function () {
      if (animation) {
        deferred.resolve(animation['in'].call(this));
      } else {
        deferred.resolve();
      }
    });

    return deferred.promise;
  },

  retile: function () {
    if (get(this, 'isVisible')) {
      scheduleOnce('afterRender', this, 'tile');
    }
  },

  tile: function () {
    var target = get(this, 'activeTarget');
    // Don't tile if there's nothing to constrain the popup menu around
    if (!get(this, 'element') || !target) {
      return;
    }

    var $popup = this.$();
    var $pointer = $popup.children('.popup-menu_pointer');

    var boundingRect = Rectangle.ofElement(window);
    var popupRect = Rectangle.ofView(this, 'padding');
    var targetRect = Rectangle.ofElement(target.element, 'padding');
    var pointerRect = Rectangle.ofElement($pointer[0], 'borders');

    if (boundingRect.intersects(targetRect)) {
      var flowName = get(this, 'flow');
      var constraints = this.container.lookup('popup-constraint:' + flowName);
      Ember.assert(fmt(
        ("The flow named '%@1' was not registered with the {{popup-menu}}.\n" +
         "Register your flow by creating a file at 'app/popup-menu/flows/%@1.js' with the following function body:\n\nexport default function %@1 () {\n  return this.orientBelow().andSnapTo(this.center);\n});"), [flowName]), constraints);
      var solution;
      for (var i = 0, len = constraints.length; i < len; i++) {
        solution = constraints[i].solveFor(boundingRect, targetRect, popupRect, pointerRect);
        if (solution.valid) { break; }
      }

      this.setProperties({
        orientation: solution.orientation,
        pointer:     solution.pointer
      });

      var offset = $popup.offsetParent().offset();
      var top = popupRect.top - offset.top;
      var left = popupRect.left - offset.left;
      $popup.css({
        top: top + 'px',
        left: left + 'px'
      });
      $pointer.css({
        top: pointerRect.top + 'px',
        left: pointerRect.left + 'px'
      });
    }
  }

});
