'use strict';

angular.module('icestudio')
  .service('graph', function($rootScope,
                             joint,
                             boards,
                             blocks,
                             profile,
                             utils,
                             common,
                             gettextCatalog,
                             window) {
    // Variables

    var z = { index: 100 };
    var graph = null;
    var paper = null;
    var selection = null;
    var selectionView = null;
    var commandManager = null;
    var mousePosition = { x: 0, y: 0 };
    var gridsize = 8;
    var state = { pan: { x: 0, y: 0 }, zoom: 1.0 };

    var self = this;

    const ZOOM_MAX = 2.1;
    const ZOOM_MIN = 0.3;
    const ZOOM_SENS = 0.3;

    this.breadcrumbs = [{ name: '', type: '' }];
    this.addingDraggableBlock = false;

    // Functions

    this.getState = function() {
      // Clone state
      return utils.clone(state);
    };

    this.setState = function(_state) {
      if (!_state) {
        _state = {
          pan: {
            x: 0,
            y: 0
          },
          zoom: 1.0
        };
      }
      this.panAndZoom.zoom(_state.zoom);
      this.panAndZoom.pan(_state.pan);
    };

    this.resetView = function() {
      this.setState(null);
    };

    this.fitContent = function() {
      if (!this.isEmpty()) {
        // Target box
        var margin = 40;
        var menuFooterHeight = 93;
        var tbox = {
          x: margin,
          y: margin,
          width: window.get().width - 2 * margin,
          height: window.get().height - menuFooterHeight - 2 * margin
        };
        // Source box
        var sbox = V(paper.viewport).bbox(true, paper.svg);
        sbox = {
          x: sbox.x * state.zoom,
          y: sbox.y * state.zoom,
          width: sbox.width * state.zoom,
          height: sbox.height * state.zoom
        };
        var scale = 1;
        if (tbox.width/sbox.width > tbox.height/sbox.height) {
          scale = tbox.height / sbox.height;
        }
        else {
          scale = tbox.width / sbox.width;
        }
        if (state.zoom * scale > 1) {
          scale = 1 / state.zoom;
        }
        var target = {
          x: tbox.x + tbox.width / 2,
          y: tbox.y + tbox.height / 2
        };
        var source = {
          x: sbox.x + sbox.width / 2,
          y: sbox.y + sbox.height / 2
        };
        this.setState({
          pan: {
            x: target.x - source.x * scale,
            y: target.y - source.y * scale
          },
          zoom: state.zoom * scale
        });
      }
      else {
        this.resetView();
      }
    };

    this.resetBreadcrumbs = function(name) {
      this.breadcrumbs = [{ name: name, type: '' }];
      utils.rootScopeSafeApply();
    };

    this.createPaper = function(element) {
      graph = new joint.dia.Graph();
      paper = new joint.dia.Paper({
        el: element,
        width: 2000,
        height: 1000,
        model: graph,
        gridSize: gridsize,
        clickThreshold: 6,
        snapLinks: { radius: 16 },
        linkPinning: false,
        embeddingMode: false,
        //markAvailable: true,
        defaultLink: new joint.shapes.ice.Wire(),
        /*guard: function(evt, view) {
          // FALSE means the event isn't guarded.
          return false;
        },*/
        validateMagnet: function(cellView, magnet) {
          // Prevent to start wires from an input port
          return (magnet.getAttribute('type') === 'output');
        },
        validateConnection: function(cellViewS, magnetS, cellViewT, magnetT, end, linkView) {
          // Prevent output-output links
          if (magnetS && magnetS.getAttribute('type') === 'output' &&
              magnetT && magnetT.getAttribute('type') === 'output') {
            if (magnetS !== magnetT) {
              // Show warning if source and target blocks are different
              warning(gettextCatalog.getString('Invalid connection'));
            }
            return false;
          }
          // Ensure right -> left connections
          if (magnetS && magnetS.getAttribute('pos') === 'right') {
            if (magnetT && magnetT.getAttribute('pos') !== 'left') {
              warning(gettextCatalog.getString('Invalid connection'));
              return false;
            }
          }
          // Ensure bottom -> top connections
          if (magnetS && magnetS.getAttribute('pos') === 'bottom') {
            if (magnetT && magnetT.getAttribute('pos') !== 'top') {
              warning(gettextCatalog.getString('Invalid connection'));
              return false;
            }
          }
          var i;
          var links = graph.getLinks();
          for (i in links) {
            var link = links[i];
            var linkIView = link.findView(paper);
            if (linkView === linkIView) {
              //Skip the wire the user is drawing
              continue;
            }
            // Prevent multiple input links
            if ((cellViewT.model.id === link.get('target').id) &&
                (magnetT.getAttribute('port') === link.get('target').port)) {
              warning(gettextCatalog.getString('Invalid multiple input connections'));
              return false;
            }
            // Prevent to connect a pull-up if other blocks are connected
            if ((cellViewT.model.get('pullup')) &&
                 (cellViewS.model.id === link.get('source').id)) {
              warning(gettextCatalog.getString('Invalid <i>Pull up</i> connection:<br>block already connected'));
              return false;
            }
            // Prevent to connect other blocks if a pull-up is connected
            if ((linkIView.targetView.model.get('pullup')) &&
                 (cellViewS.model.id === link.get('source').id)) {
              warning(gettextCatalog.getString('Invalid block connection:<br><i>Pull up</i> already connected'));
              return false;
            }
          }
          // Ensure input -> pull-up connections
          if (cellViewT.model.get('pullup')) {
            var ret = (cellViewS.model.get('blockType') === 'basic.input');
            if (!ret) {
              warning(gettextCatalog.getString('Invalid <i>Pull up</i> connection:<br>only <i>Input</i> blocks allowed'));
            }
            return ret;
          }
          // Prevent different size connections
          var tsize;
          var lsize = linkView.model.get('size');
          var portId = magnetT.getAttribute('port');
          var tLeftPorts = cellViewT.model.get('leftPorts');
          for (i in tLeftPorts) {
            var port = tLeftPorts[i];
            if (portId === port.id) {
              tsize = port.size;
              break;
            }
          }
          tsize = tsize || 1;
          lsize = lsize || 1;
          if (tsize !== lsize) {
            warning(gettextCatalog.getString('Invalid connection: {{a}} → {{b}}', { a: lsize, b: tsize }));
            return false;
          }
          // Prevent loop links
          return magnetS !== magnetT;
        }
      });

      // Command Manager

      commandManager = new joint.dia.CommandManager({
        paper: paper,
        graph: graph
      });

      // Selection View

     selection = new Backbone.Collection();
     selectionView = new joint.ui.SelectionView({
       paper: paper,
       graph: graph,
       model: selection,
       state: state
     });

      paper.options.enabled = true;
      paper.options.warningTimer = false;

      function warning(message) {
        if (!paper.options.warningTimer) {
          paper.options.warningTimer = true;
          alertify.warning(message, 5);
          setTimeout(function() {
            paper.options.warningTimer = false;
          }, 4000);
        }
      }

      var targetElement = element[0];

      this.panAndZoom = svgPanZoom(targetElement.childNodes[0],
      {
        fit: false,
        center: false,
        zoomEnabled: true,
        panEnabled: false,
        zoomScaleSensitivity: ZOOM_SENS,
        dblClickZoomEnabled: false,
        minZoom: ZOOM_MIN,
        maxZoom: ZOOM_MAX,
        eventsListenerElement: targetElement,
        /*beforeZoom: function(oldzoom, newzoom) {
        },*/
        onZoom: function(scale) {
          state.zoom = scale;
          // Close expanded combo
          if (document.activeElement.className === 'select2-search__field') {
            $('select').select2('close');
          }
          updateCellBoxes();
        },
        /*beforePan: function(oldpan, newpan) {
        },*/
        onPan: function(newPan) {
          state.pan = newPan;
          graph.trigger('state', state);
          updateCellBoxes();
        }
      });

      function updateCellBoxes() {
        var cells = graph.getCells();
        selectionView.options.state = state;
        _.each(cells, function(cell) {
          if (!cell.isLink()) {
            cell.attributes.state = state;
            var elementView = paper.findViewByModel(cell);
            // Pan blocks
            elementView.updateBox();
            // Pan selection boxes
            selectionView.updateBox(elementView.model);
          }
        });
      }

      // Events

      $('body').mousemove(function(event) {
        mousePosition = {
          x: event.pageX,
          y: event.pageY
        };
      });

      selectionView.on('selection-box:pointerdown', function(/*evt*/) {
        // Move selection to top view
        if (selection) {
          selection.each(function(cell) {
            var cellView = paper.findViewByModel(cell);
            if (!cellView.model.isLink()) {
              if (cellView.$box.css('z-index') < z.index) {
                cellView.$box.css('z-index', ++z.index);
              }
            }
          });
        }
      });

      selectionView.on('selection-box:pointerclick', function(evt) {
        if (self.addingDraggableBlock) {
          // Set new block position
          self.addingDraggableBlock = false;
          disableSelected();
          updateWiresOnObstacles();
        }
        else {
          // Toggle selected cell
          if (utils.hasShift(evt)) {
            var cell = selection.get($(evt.target).data('model'));
            selection.reset(selection.without(cell));
            selectionView.destroySelectionBox(cell);
          }
      }
      });

      var pointerDown = false;
      var dblClickCell = false;

      paper.on('cell:pointerclick', function(cellView, evt/*, x, y*/) {
        if (utils.hasShift(evt)) {
          // If Shift is pressed process the click (no Shift+dblClick allowed)
          processCellClick(cellView, evt);
        }
        else {
          // If not, wait 200ms to ensure that it's not a dblclick
          var ensureTime = 200;
          pointerDown = false;
          setTimeout(function() {
            if (!dblClickCell && !pointerDown) {
              processCellClick(cellView, evt);
            }
          }, ensureTime);
        }

        function processCellClick(cellView, evt) {
          if (paper.options.enabled) {
            if (!cellView.model.isLink()) {
              // Disable current focus
              document.activeElement.blur();
              if (utils.hasLeftButton(evt)) {
                if (!utils.hasShift(evt)) {
                  // Cancel previous selection
                  disableSelected();
                }
                // Add cell to selection
                selection.add(cellView.model);
                selectionView.createSelectionBox(cellView.model);
                //unhighlight(cellView);
              }
            }
          }
        }
      });

      paper.on('cell:pointerdown', function(/*cellView, evt, x, y*/) {
        if (paper.options.enabled) {
          pointerDown = true;
        }
      });

      paper.on('cell:pointerup', function(/*cellView, evt, x, y*/) {
        if (paper.options.enabled) {
          updateWiresOnObstacles();
        }
      });

      paper.on('cell:pointerdblclick', function(cellView, evt/*, x, y*/) {
        if (!utils.hasShift(evt)) {
          // Allow dblClick if Shift is not pressed
          dblClickCell = true;
          processDblClick(cellView);
          // Enable click event
          setTimeout(function() { dblClickCell = false; }, 200);
        }
      });

      function processDblClick(cellView) {
        var type =  cellView.model.get('blockType');
        if (type.indexOf('basic.') !== -1) {
          if (paper.options.enabled) {
            blocks.editBasic(type, cellView, function(cell) {
              addCell(cell);
              selectionView.cancelSelection();
            });
          }
        }
        else if (common.allDependencies[type]) {
          z.index = 1;
          var project = common.allDependencies[type];
          var breadcrumbsLength = self.breadcrumbs.length;
          $rootScope.$broadcast('navigateProject', {
            update: breadcrumbsLength === 1,
            project: project
          });
          self.breadcrumbs.push({ name: project.package.name || '#', type: type });
          utils.rootScopeSafeApply();
        }
      }

      paper.on('blank:pointerdown', function(evt, x, y) {
        // Disable current focus
        document.activeElement.blur();

        if (utils.hasLeftButton(evt)) {
          if (utils.hasCtrl(evt)) {
            if (!self.isEmpty()) {
              self.panAndZoom.enablePan();
            }
          }
          else if (paper.options.enabled) {
            selectionView.startSelecting(evt, x, y);
          }
        }
        else if (utils.hasRightButton(evt)) {
          if (!self.isEmpty()) {
            self.panAndZoom.enablePan();
          }
        }
      });

      paper.on('blank:pointerup', function(/*cellView, evt*/) {
        self.panAndZoom.disablePan();
      });

      paper.on('cell:mouseover', function(cellView, evt) {
        // Move selection to top view if !mousedown
        if (!utils.hasButtonPressed(evt)) {
          if (!cellView.model.isLink()) {
            //highlight(cellView);
            if (cellView.$box.css('z-index') < z.index) {
              cellView.$box.css('z-index', ++z.index);
            }
          }
        }
      });

      /*paper.on('cell:mouseout', function(cellView, evt) {
        if (!utils.hasButtonPressed(evt)) {
          if (!cellView.model.isLink()) {
            unhighlight(cellView);
          }
        }
      });*/

      /*paper.on('cell:pointerdown', function(cellView) {
        if (paper.options.enabled) {
          if (cellView.model.isLink()) {
            // Unhighlight source block of the wire
            unhighlight(paper.findViewByModel(cellView.model.get('source').id));
          }
        }
      });

      graph.on('change:position', function(cell) {
        if (!selectionView.isTranslating()) {
          // Update wires on obstacles motion
          updateWiresOnObstacles();
        }
      });*/

      graph.on('add change:source change:target', function(cell) {
        if (cell.isLink() && cell.get('source').id) {
          // Link connected
          var target = cell.get('target');
          if (target.id) {
            // Connected to a port
            cell.attributes.lastTarget = target;
            updatePortDefault(target, false);
          }
          else {
            // Moving the wire connection
            target = cell.get('lastTarget');
            updatePortDefault(target, true);
          }
        }
      });

      graph.on('remove', function(cell) {
        if (cell.isLink()) {
          // Link removed
          var target = cell.get('target');
          if (!target.id) {
            target = cell.get('lastTarget');
          }
          updatePortDefault(target, true);
        }
      });

      function updatePortDefault(target, value) {
        if (target) {
          var i, port;
          var block = graph.getCell(target.id);
          if (block) {
            var data = block.get('data');
            if (data && data.ports && data.ports.in) {
              for (i in data.ports.in) {
                port = data.ports.in[i];
                if (port.name === target.port && port.default) {
                  port.default.apply = value;
                  break;
                }
              }
              paper.findViewByModel(block.id).updateBox();
            }
          }
        }
      }

      // Initialize state
      graph.trigger('state', state);

    };

    function updateWiresOnObstacles() {
      var cells = graph.getCells();
      _.each(cells, function(cell) {
        if (cell.isLink()) {
          paper.findViewByModel(cell).update();
        }
      });
    }

    this.setBoardRules = function(rules) {
      var cells = graph.getCells();
      profile.set('boardRules', rules);

      _.each(cells, function(cell) {
        if (!cell.isLink()) {
          cell.attributes.rules = rules;
          var cellView = paper.findViewByModel(cell);
          cellView.updateBox();
        }
      });
    };

    this.undo = function() {
      disableSelected();
      commandManager.undo();
    };

    this.redo = function() {
      disableSelected();
      commandManager.redo();
    };

    this.clearAll = function() {
      graph.clear();
      this.appEnable(true);
      selectionView.cancelSelection();
    };

    this.appEnable = function(value) {
      paper.options.enabled = value;
      if (value) {
        angular.element('#menu').removeClass('is-disabled');
        angular.element('.paper').removeClass('looks-disabled');
        angular.element('.board-container').removeClass('looks-disabled');
        angular.element('.banner').addClass('hidden');
      }
      else {
        angular.element('#menu').addClass('is-disabled');
        angular.element('.paper').addClass('looks-disabled');
        angular.element('.board-container').addClass('looks-disabled');
        angular.element('.banner').removeClass('hidden');
      }
      var cells = graph.getCells();
      _.each(cells, function(cell) {
        var cellView = paper.findViewByModel(cell.id);
        cellView.options.interactive = value;
        if (cell.get('type') !== 'ice.Generic') {
          if (value) {
            cellView.$el.removeClass('disable-graph');
          }
          else {
            cellView.$el.addClass('disable-graph');
          }
        }
        else if (cell.get('type') !== 'ice.Wire') {
          if (value) {
            cellView.$el.find('.port-body').removeClass('disable-graph');
          }
          else {
            cellView.$el.find('.port-body').addClass('disable-graph');
          }
        }
      });
    };

    this.createBlock = function(type, block) {
      blocks.newGeneric(type, block, function(cell) {
        self.addDraggableCell(cell);
      });
    };

    this.createBasicBlock = function(type) {
      blocks.newBasic(type, function(cells) {
        self.addDraggableCells(cells);
      });
    };

    this.addDraggableCell = function(cell) {
      this.addingDraggableBlock = true;
      var menuHeight = $('#menu').height();
      cell.set('position', {
        x: Math.round(((mousePosition.x - state.pan.x) / state.zoom - cell.get('size').width/2) / gridsize) * gridsize,
        y: Math.round(((mousePosition.y - state.pan.y - menuHeight) / state.zoom - cell.get('size').height/2) / gridsize) * gridsize,
      });
      graph.trigger('batch:start');
      addCell(cell);
      disableSelected();
      var opt = { transparent: true, initooltip: false };
      var noBatch = true;
      selection.add(cell);
      selectionView.createSelectionBox(cell, opt);
      selectionView.startTranslatingSelection({ clientX: mousePosition.x, clientY: mousePosition.y }, noBatch);
    };

    this.addDraggableCells = function(cells) {
      this.addingDraggableBlock = true;
      var menuHeight = $('#menu').height();
      if (cells.length > 0) {
        var firstCell = cells[0];
        var offset = {
          x: Math.round(((mousePosition.x - state.pan.x) / state.zoom - firstCell.get('size').width/2) / gridsize) * gridsize - firstCell.get('position').x,
          y: Math.round(((mousePosition.y - state.pan.y - menuHeight) / state.zoom - firstCell.get('size').height/2) / gridsize) * gridsize - firstCell.get('position').y,
        };
        _.each(cells, function(cell) {
          var position = cell.get('position');
          cell.set('position', {
            x: position.x + offset.x,
            y: position.y + offset.y
          });
        });
        graph.trigger('batch:start');
        addCells(cells);
        disableSelected();
        var opt = { transparent: true };
        var noBatch = true;
        _.each(cells, function(cell) {
          selection.add(cell);
          selectionView.createSelectionBox(cell, opt);
        });
        selectionView.startTranslatingSelection({ clientX: mousePosition.x, clientY: mousePosition.y }, noBatch);
      }
    };

    this.toJSON = function() {
      return graph.toJSON();
    };

    this.getCells = function() {
      return graph.getCells();
    };

    this.setCells = function(cells) {
      graph.attributes.cells.models = cells;
    };

    this.selectBoard = function(board, reset) {
      graph.startBatch('change');
      // Trigger board event
      var data = {
        previous: common.selectedBoard,
        next: board
      };
      graph.trigger('board', { data: data });
      var newBoard = boards.selectBoard(board.name);
      if (reset) {
        resetBlocks();
      }
      graph.stopBatch('change');
      return newBoard;
    };

    this.setInfo = function(values, newValues, project) {
      graph.startBatch('change');
      // Trigger info event
      var data = {
        previous: values,
        next: newValues
      };
      graph.trigger('info', { data: data });
      project.set('package', {
        name: newValues[0],
        version: newValues[1],
        description: newValues[2],
        author: newValues[3],
        image: newValues[4]
      });
      graph.stopBatch('change');
    };

    this.selectLanguage = function(language) {
      graph.startBatch('change');
      // Trigger lang event
      var data = {
        previous: profile.get('language'),
        next: language
      };
      graph.trigger('lang', { data: data });
      language = utils.setLocale(language);
      graph.stopBatch('change');
      return language;
    };

    function resetBlocks() {
      var data, connectedLinks;
      var cells = graph.getCells();
      _.each(cells, function(cell) {
        if (cell.isLink()) {
          return;
        }
        var type = cell.get('blockType');
        if (type === 'basic.input' || type === 'basic.output') {
          // Reset choices in all Input / blocks
          var view = paper.findViewByModel(cell.id);
          cell.set('choices', (type === 'basic.input') ? common.pinoutInputHTML : common.pinoutOutputHTML);
          view.clearValues();
          view.applyChoices();
        }
        else if (type === 'basic.code') {
          // Reset rules in Code block ports
          data = utils.clone(cell.get('data'));
          connectedLinks = graph.getConnectedLinks(cell);
          if (data && data.ports && data.ports.in) {
            _.each(data.ports.in, function(port) {
              var connected = false;
              _.each(connectedLinks, function(connectedLink) {
                if (connectedLink.get('target').port === port.name) {
                  connected = true;
                  return false;
                }
              });
              port.default = utils.hasInputRule(port.name, !connected);
              cell.set('data', data);
              paper.findViewByModel(cell.id).updateBox();
            });
          }
        }
        else if (type.indexOf('basic.') === -1) {
          // Reset rules in Generic block ports
          var block = common.allDependencies[type];
          data = { ports: { in: [] }};
          connectedLinks = graph.getConnectedLinks(cell);
          if (block.design.graph.blocks) {
            _.each(block.design.graph.blocks, function(item) {
              if (item.type === 'basic.input' && !item.data.range) {
                var connected = false;
                _.each(connectedLinks, function(connectedLink) {
                  if (connectedLink.get('target').port === item.id) {
                    connected = true;
                    return false;
                  }
                });
                data.ports.in.push({
                  name: item.id,
                  default: utils.hasInputRule((item.data.clock ? 'clk' : '') || item.data.name, !connected)
                });
              }
              cell.set('data', data);
              paper.findViewByModel(cell.id).updateBox();
            });
          }
        }
      });
    }

    this.resetCommandStack = function() {
      commandManager.reset();
    };

    this.cutSelected = function() {
      if (hasSelection()) {
        utils.copyToClipboard(selection, graph);
        this.removeSelected();
      }
    };

    this.copySelected = function() {
      if (hasSelection()) {
        utils.copyToClipboard(selection, graph);
      }
    };

    this.pasteSelected = function() {
      if (document.activeElement.tagName === 'A' ||
          document.activeElement.tagName === 'BODY')
      {
        utils.pasteFromClipboard(function(object) {
          if (object.version === common.VERSION) {
            self.appendDesign(object.design, object.dependencies);
          }
        });
      }
    };

    this.selectAll = function() {
      disableSelected();
      var cells = graph.getCells();
      _.each(cells, function(cell) {
        if (!cell.isLink()) {
          selection.add(cell);
          selectionView.createSelectionBox(cell);
          //unhighlight(cellView);
        }
      });
    };

    /*function highlight(cellView) {
      if (cellView) {
        switch(cellView.model.get('type')) {
          case 'ice.Input':
          case 'ice.Output':
            if (cellView.model.get('data').virtual) {
              cellView.$box.addClass('highlight-green');
            }
            else {
              cellView.$box.addClass('highlight-yellow');
            }
            break;
          case 'ice.Constant':
            cellView.$box.addClass('highlight-orange');
            break;
          case 'ice.Code':
            cellView.$box.addClass('highlight-blue');
            break;
          case 'ice.Generic':
            if (cellView.model.get('config')) {
              cellView.$box.addClass('highlight-yellow');
            }
            else {
              cellView.$box.addClass('highlight-blue');
            }
            break;
          case 'ice.Info':
            cellView.$box.addClass('highlight-gray');
            break;
        }
      }
    }

    function unhighlight(cellView) {
      if (cellView) {
        switch(cellView.model.get('type')) {
          case 'ice.Input':
          case 'ice.Output':
            if (cellView.model.get('data').virtual) {
              cellView.$box.removeClass('highlight-green');
            }
            else {
              cellView.$box.removeClass('highlight-yellow');
            }
            break;
          case 'ice.Constant':
            cellView.$box.removeClass('highlight-orange');
            break;
          case 'ice.Code':
            cellView.$box.removeClass('highlight-blue');
            break;
          case 'ice.Generic':
            if (cellView.model.get('config')) {
              cellView.$box.removeClass('highlight-yellow');
            }
            else {
              cellView.$box.removeClass('highlight-blue');
            }
            break;
          case 'ice.Info':
            cellView.$box.removeClass('highlight-gray');
            break;
        }
      }
    }*/

    function hasSelection() {
      return selection && selection.length > 0;
    }

    this.removeSelected = function() {
      if (hasSelection()) {
        graph.removeCells(selection.models);
        selectionView.cancelSelection();
        updateWiresOnObstacles();
      }
    };

    $(document).on('disableSelected', function() {
      disableSelected();
    });

    function disableSelected() {
      if (hasSelection()) {
        selectionView.cancelSelection();
      }
    }

    var stepValue = 8;

    this.stepLeft = function() {
      performStep({ x: -stepValue, y: 0 });
    };

    this.stepUp = function() {
      performStep({ x: 0, y: -stepValue });
    };

    this.stepRight = function() {
      performStep({ x: stepValue, y: 0 });
    };

    this.stepDown = function() {
      performStep({ x: 0, y: stepValue });
    };

    var stepCounter = 0;
    var stepTimer = null;
    var stepGroupingInterval = 500;
    var allowStep = true;
    var allosStepInterval = 200;

    function performStep(offset) {
      if (selection && allowStep) {
        allowStep = false;
        // Check consecutive-change interval
        if (Date.now() - stepCounter < stepGroupingInterval) {
          clearTimeout(stepTimer);
        }
        else {
          graph.startBatch('change');
        }
        // Move a step
        step(offset);
        // Launch timer
        stepTimer = setTimeout(function() {
          graph.stopBatch('change');
        }, stepGroupingInterval);
        // Reset counter
        stepCounter = Date.now();
        setTimeout(function() {
          allowStep = true;
        }, allosStepInterval);
      }
    }

    function step(offset) {
      var processedWires = {};
      // Translate blocks
      selection.each(function(cell) {
        cell.translate(offset.x, offset.y);
        selectionView.updateBox(cell);
        // Translate link vertices
        var connectedWires = graph.getConnectedLinks(cell);
        _.each(connectedWires, function(wire) {

          if (processedWires[wire.id]) {
            return;
          }

          var vertices = wire.get('vertices');
          if (vertices && vertices.length) {
            var newVertices = [];
            _.each(vertices, function(vertex) {
              newVertices.push({ x: vertex.x + offset.x, y: vertex.y + offset.y });
            });
            wire.set('vertices', newVertices);
          }

          processedWires[wire.id] = true;
        });
      });
    }

    this.isEmpty = function() {
      return (graph.getCells().length === 0);
    };

    this.isEnabled = function() {
      return paper.options.enabled;
    };

    this.loadDesign = function(design, opt, callback) {
      if (design &&
          design.graph &&
          design.graph.blocks &&
          design.graph.wires) {

        opt = opt || {};

        $('body').addClass('waiting');

        setTimeout(function() {

          self.setState(design.state);

          commandManager.stopListening();

          self.clearAll();

          var cells = graphToCells(design.graph, opt);

          graph.addCells(cells);

          self.appEnable(!opt.disabled);

          if (!opt.disabled) {
            commandManager.listen();
          }

          if (callback) {
            callback();
          }

          $('body').removeClass('waiting');

        }, 20);

        return true;
      }
    };

    function graphToCells(_graph, opt) {
      // Options:
      // - new: assign a new id to all the cells
      // - reset: clear I/O blocks values
      // - disabled: set disabled flag to the blocks
      // - offset: apply an offset to all the cells

      var cell;
      var cells = [];
      var blocksMap = {};

      opt = opt || {};

      // Blocks
      _.each(_graph.blocks, function(blockInstance) {
        if (blockInstance.type.indexOf('basic.') !== -1) {
          if (opt.reset &&
              (blockInstance.type === 'basic.input' ||
               blockInstance.type === 'basic.output')) {
            var pins = blockInstance.data.pins;
            for (var i in pins) {
              pins[i].name = '';
              pins[i].value = 0;
            }
          }
          cell = blocks.loadBasic(blockInstance, opt.disabled);
        }
        else {
          if (blockInstance.type in common.allDependencies) {
            cell = blocks.loadGeneric(blockInstance, common.allDependencies[blockInstance.type], opt.disabled);
          }
        }
        blocksMap[cell.id] = cell;
        if (opt.new) {
          var oldId = cell.id;
          cell = cell.clone();
          blocksMap[oldId] = cell;
        }
        if (opt.offset) {
          cell.translate(opt.offset.x, opt.offset.y);
        }
        updateCellAttributes(cell);
        cells.push(cell);
      });

      // Wires
      _.each(_graph.wires, function(wireInstance) {
        var source = blocksMap[wireInstance.source.block];
        var target = blocksMap[wireInstance.target.block];
        if (opt.offset) {
          var newVertices = [];
          var vertices = wireInstance.vertices;
          if (vertices && vertices.length) {
            _.each(vertices, function(vertex) {
              newVertices.push({
                x: vertex.x + opt.offset.x,
                y: vertex.y + opt.offset.y
              });
            });
          }
          wireInstance.vertices = newVertices;
        }
        cell = blocks.loadWire(wireInstance, source, target);
        if (opt.new) {
          cell = cell.clone();
        }
        updateCellAttributes(cell);
        cells.push(cell);
      });

      return cells;
    }

    this.appendDesign = function(design, dependencies) {
      if (design &&
          dependencies &&
          design.graph &&
          design.graph.blocks &&
          design.graph.wires) {

        selectionView.cancelSelection();

        // Merge dependencies
        for (var type in dependencies) {
          if (!(type in common.allDependencies)) {
            common.allDependencies[type] = dependencies[type];
          }
        }

        // Append graph cells: blocks and wires
        // - assign new UUIDs to the cells
        // - add the graph in the mouse position
        var origin = graphOrigin(design.graph);
        var menuHeight = $('#menu').height();
        var opt = {
          new: true,
          disabled: false,
          reset: design.board !== common.selectedBoard.name,
          offset: {
            x: Math.round(((mousePosition.x - state.pan.x) / state.zoom - origin.x) / gridsize) * gridsize,
            y: Math.round(((mousePosition.y - state.pan.y - menuHeight) / state.zoom - origin.y) / gridsize) * gridsize,
          }
        };
        var cells = graphToCells(design.graph, opt);
        graph.addCells(cells);

        // Select pasted elements
        _.each(cells, function(cell) {
          if (!cell.isLink()) {
            var cellView = paper.findViewByModel(cell);
            if (cellView.$box.css('z-index') < z.index) {
              cellView.$box.css('z-index', ++z.index);
            }
            selection.add(cell);
            selectionView.createSelectionBox(cell);
            //unhighlight(cellView);
          }
        });
      }
    };

    function graphOrigin(graph) {
      var origin = { x: Infinity, y: Infinity };
      _.each(graph.blocks, function(block) {
        var position = block.position;
        if (position.x < origin.x) {
          origin.x = position.x;
        }
        if (position.y < origin.y) {
          origin.y = position.y;
        }
      });
      return origin;
    }

    function updateCellAttributes(cell) {
      cell.attributes.state = state;
      cell.attributes.rules = profile.get('boardRules');
      //cell.attributes.zindex = z.index;
    }

    function addCell(cell) {
      if (cell) {
        updateCellAttributes(cell);
        graph.addCell(cell);
        if (!cell.isLink()) {
          var cellView = paper.findViewByModel(cell);
          if (cellView.$box.css('z-index') < z.index) {
            cellView.$box.css('z-index', ++z.index);
          }
        }
      }
    }

    function addCells(cells) {
      _.each(cells, function(cell) {
        updateCellAttributes(cell);
      });
      graph.addCells(cells);
      _.each(cells, function(cell) {
        if (!cell.isLink()) {
          var cellView = paper.findViewByModel(cell);
          if (cellView.$box.css('z-index') < z.index) {
            cellView.$box.css('z-index', ++z.index);
          }
        }
      });
    }

    this.resetCodeErrors = function() {
      var cells = graph.getCells();
      return new Promise(function(resolve) {
        _.each(cells, function(cell) {
          var cellView;
          if ((cell.get('type') === 'ice.Code') ||
              (cell.get('type') === 'ice.Generic') ||
              (cell.get('type') === 'ice.Constant'))
          {
            cellView = paper.findViewByModel(cell);
            cellView.$box.removeClass('highlight-error');
            if (cell.get('type') === 'ice.Code') {
              cellView.clearAnnotations();
            }
          }
        });
        resolve();
      });
    };

    $(document).on('codeError', function(evt, codeError) {
      var cells = graph.getCells();
      _.each(cells, function(cell) {
        var blockId, cellView;
        if ((codeError.blockType === 'code' && cell.get('type') === 'ice.Code') ||
            (codeError.blockType === 'constant' && cell.get('type') === 'ice.Constant'))
         {
          blockId = utils.digestId(cell.id);
        }
        else if (codeError.blockType === 'generic' && cell.get('type') === 'ice.Generic') {
          blockId = utils.digestId(cell.attributes.blockType);
        }
        if (codeError.blockId === blockId) {
          cellView = paper.findViewByModel(cell);
          if (codeError.type === 'error') {
            cellView.$box.addClass('highlight-error');
          }
          if (cell.get('type') === 'ice.Code') {
            cellView.setAnnotation(codeError);
          }
        }
      });
    });

  });
