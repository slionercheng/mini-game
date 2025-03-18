document.addEventListener('DOMContentLoaded', () => {
    // 获取DOM元素
    const welcomeScreen = document.getElementById('welcome-screen');
    const gameScreen = document.getElementById('game-screen');
    const playerNameInput = document.getElementById('player-name');
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const roomIdInput = document.getElementById('room-id-input');
    const roomIdDisplay = document.getElementById('room-id-display');
    const playerRole = document.getElementById('player-role');
    const currentTurn = document.getElementById('current-turn');
    const gameStatus = document.getElementById('game-status');
    const gameBoard = document.getElementById('game-board');
    const restartBtn = document.getElementById('restart-btn');
    const undoBtn = document.getElementById('undo-btn');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const refreshRoomsBtn = document.getElementById('refresh-rooms-btn');
    const roomList = document.getElementById('room-list');
    const undoConfirmation = document.getElementById('undo-confirmation');
    const undoMessage = document.getElementById('undo-message');
    const approveUndoBtn = document.getElementById('approve-undo-btn');
    const rejectUndoBtn = document.getElementById('reject-undo-btn');

    // 游戏状态
    const gameState = {
        roomId: null,
        playerId: null,
        playerRole: null,
        board: Array(15).fill().map(() => Array(15).fill(0)),
        currentPlayer: 1,
        gameOver: false,
        lastMove: null // 记录最后一步棋的位置
    };

    // 棋盘绘制参数
    const ctx = gameBoard.getContext('2d');
    let gridSize; // 将在resizeCanvas函数中计算
    const colors = {
        board: '#f0c75e',
        lines: '#000',
        redPiece: '#f44336',
        bluePiece: '#2196F3'
    };
    
    // 设置画布大小为响应式
    function resizeCanvas() {
        const container = gameBoard.parentElement;
        const maxWidth = Math.min(container.clientWidth - 40, 600); // 最大宽度为600px或容器宽度-40px
        
        gameBoard.width = maxWidth;
        gameBoard.height = maxWidth;
        
        // 重新计算棋盘格子大小
        gridSize = gameBoard.width / 14; // 14等分，产生15个交叉点
        
        // 重绘棋盘
        if (gameState.roomId) {
            drawBoardWithHover();
        }
    }
    
    // 初始化时调整画布大小
    resizeCanvas();
    
    // 当窗口大小变化时重新调整画布大小
    window.addEventListener('resize', resizeCanvas);

    // 连接Socket.IO，配置长连接和重连机制
    const socket = io({
        transports: ['websocket'], // 优先使用WebSocket
        upgrade: false, // 禁止降级到轮询
        reconnection: true, // 启用重连
        reconnectionAttempts: Infinity, // 无限重连尝试
        reconnectionDelay: 2000, // 重连延迟设置为2秒
        reconnectionDelayMax: 2000, // 最大重连延迟也设置为2秒
        timeout: 20000 // 连接超时时间
    });
    
    // 创建网络状态提示元素
    const networkStatus = document.createElement('div');
    networkStatus.id = 'network-status';
    networkStatus.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        padding: 10px;
        background-color: #f44336;
        color: white;
        text-align: center;
        z-index: 1000;
        font-weight: bold;
        display: none;
    `;
    document.body.appendChild(networkStatus);
    
    // 显示网络状态提示
    function showNetworkStatus(message, isError = true) {
        networkStatus.textContent = message;
        networkStatus.style.backgroundColor = isError ? '#f44336' : '#4CAF50';
        networkStatus.style.display = 'block';
        
        if (!isError) {
            setTimeout(() => {
                networkStatus.style.display = 'none';
            }, 3000);
        }
    }
    
    // 隐藏网络状态提示
    function hideNetworkStatus() {
        networkStatus.style.display = 'none';
    }
    
    // 连接状态处理
    socket.on('connect', () => {
        console.log('已连接到服务器');
        hideNetworkStatus();
        
        if (gameState.statusMessage && gameState.statusMessage.includes('连接已断开')) {
            gameState.statusMessage = '已重新连接到服务器';
            updateGameInfo();
            showNetworkStatus('已重新连接到服务器', false);
            
            // 如果已经在游戏中，尝试重新加入房间
            if (gameState.roomId && gameState.playerId) {
                socket.emit('rejoin_room', { 
                    room_id: gameState.roomId, 
                    player_id: gameState.playerId 
                });
            }
            
            // 3秒后清除状态消息
            setTimeout(() => {
                if (gameState.statusMessage === '已重新连接到服务器') {
                    gameState.statusMessage = '';
                    updateGameInfo();
                }
            }, 3000);
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('连接错误:', error);
        gameState.statusMessage = '连接错误，请检查网络';
        updateGameInfo();
        showNetworkStatus('连接错误，请检查网络');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('断开连接:', reason);
        gameState.statusMessage = '连接已断开，正在尝试重连...';
        updateGameInfo();
        showNetworkStatus('连接已断开，正在尝试重连...');
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`尝试重连 (${attemptNumber})...`);
        gameState.statusMessage = `连接已断开，正在尝试重连(${attemptNumber})...`;
        updateGameInfo();
        showNetworkStatus(`连接已断开，正在尝试重连(${attemptNumber})...`);
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log(`重连成功，尝试次数: ${attemptNumber}`);
        showNetworkStatus('重连成功！', false);
    });
    
    socket.on('reconnect_error', (error) => {
        console.error('重连错误:', error);
        showNetworkStatus('重连错误，将再次尝试...');
    });
    
    socket.on('reconnect_failed', () => {
        console.log('重连失败');
        gameState.statusMessage = '重连失败，请刷新页面';
        updateGameInfo();
        showNetworkStatus('重连失败，请刷新页面');
    });

    // 创建房间
    createRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim() || '玩家1';
        if (!playerName) {
            alert('请输入您的昵称');
            return;
        }
        socket.emit('create_room', { name: playerName });
    });

    // 加入房间
    joinRoomBtn.addEventListener('click', () => {
        const roomId = roomIdInput.value.trim();
        if (!roomId) {
            alert('请输入房间ID');
            return;
        }
        const playerName = playerNameInput.value.trim();
        if (!playerName) {
            alert('请输入您的昵称');
            return;
        }
        socket.emit('join_room', { room_id: roomId, name: playerName });
    });
    
    // 刷新房间列表
    refreshRoomsBtn.addEventListener('click', () => {
        fetchRoomList();
    });
    
    // 获取房间列表
    function fetchRoomList() {
        roomList.innerHTML = '<p class="loading-text">加载中...</p>';
        
        fetch('/api/rooms')
            .then(response => response.json())
            .then(data => {
                if (data.rooms && data.rooms.length > 0) {
                    displayRoomList(data.rooms);
                } else {
                    roomList.innerHTML = '<p class="loading-text">当前没有可用房间</p>';
                }
            })
            .catch(error => {
                console.error('获取房间列表失败:', error);
                roomList.innerHTML = '<p class="loading-text">获取房间列表失败</p>';
            });
    }
    
    // 显示房间列表
    function displayRoomList(rooms) {
        roomList.innerHTML = '';
        
        rooms.forEach(room => {
            const roomItem = document.createElement('div');
            roomItem.className = 'room-item';
            roomItem.dataset.roomId = room.id;
            
            const roomInfo = document.createElement('div');
            roomInfo.className = 'room-info';
            
            const roomId = document.createElement('div');
            roomId.className = 'room-id';
            roomId.textContent = `房间ID: ${room.id}`;
            
            const roomName = document.createElement('div');
            roomName.className = 'room-name';
            roomName.textContent = room.created_at;
            
            const roomPlayers = document.createElement('div');
            roomPlayers.className = 'room-players';
            roomPlayers.textContent = `玩家数: ${room.players}/2`;
            
            const roomStatus = document.createElement('div');
            roomStatus.className = 'room-status';
            roomStatus.textContent = room.status || (room.players < 2 ? '可加入' : '已满');
            if (roomStatus.textContent === '已满') {
                roomStatus.classList.add('room-full');
            }
            
            roomInfo.appendChild(roomId);
            roomInfo.appendChild(roomName);
            roomInfo.appendChild(roomPlayers);
            roomInfo.appendChild(roomStatus);
            
            const joinButton = document.createElement('button');
            joinButton.textContent = '加入';
            joinButton.className = 'join-btn';
            
            // 如果房间已满，禁用加入按钮但仍然显示
            if (room.players >= 2) {
                joinButton.disabled = true;
                joinButton.classList.add('disabled');
                joinButton.title = '房间已满';
            }
            
            roomItem.appendChild(roomInfo);
            roomItem.appendChild(joinButton);
            
            roomList.appendChild(roomItem);
            
            // 点击房间项填充房间ID
            roomItem.addEventListener('click', () => {
                const allRoomItems = document.querySelectorAll('.room-item');
                allRoomItems.forEach(item => item.classList.remove('selected'));
                roomItem.classList.add('selected');
                roomIdInput.value = room.id;
            });
            
            // 点击加入按钮
            joinButton.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                roomIdInput.value = room.id;
                
                // 如果房间已满，则不允许加入
                if (room.players >= 2) {
                    alert('房间已满，无法加入');
                    return;
                }
                
                const playerName = playerNameInput.value.trim();
                if (!playerName) {
                    alert('请输入您的昵称');
                    return;
                }
                
                socket.emit('join_room', { room_id: room.id, name: playerName });
            });
        });
    }
    
    // 初始加载房间列表
    fetchRoomList();

    // 离开房间
    leaveRoomBtn.addEventListener('click', () => {
        window.location.reload();
    });

    // 重新开始游戏
    restartBtn.addEventListener('click', () => {
        if (confirm('确定要请求重新开始游戏吗？需要两位玩家都同意才能重新开始。')) {
            socket.emit('restart_game');
        }
    });
    
    // 添加惜棋按钮的点击事件
    undoBtn.addEventListener('click', () => {
        // 只能惜自己的棋，并且当前是对方回合时
        if (gameState.currentPlayer !== gameState.playerRole && !gameState.gameOver) {
            socket.emit('request_undo');
            gameState.statusMessage = '已发送惜棋请求，等待对方同意...';
            updateGameInfo();
        } else if (gameState.gameOver) {
            gameState.statusMessage = '游戏已结束，无法惜棋';
            updateGameInfo();
            
            // 3秒后清除状态消息
            setTimeout(() => {
                gameState.statusMessage = '';
                updateGameInfo();
            }, 3000);
        } else {
            gameState.statusMessage = '只能在对方回合时惜自己的棋';
            updateGameInfo();
            
            // 3秒后清除状态消息
            setTimeout(() => {
                gameState.statusMessage = '';
                updateGameInfo();
            }, 3000);
        }
    });
    
    // 添加同意惜棋按钮的点击事件
    approveUndoBtn.addEventListener('click', () => {
        socket.emit('approve_undo');
        undoConfirmation.style.display = 'none';
    });
    
    // 添加拒绝惜棋按钮的点击事件
    rejectUndoBtn.addEventListener('click', () => {
        socket.emit('reject_undo');
        undoConfirmation.style.display = 'none';
    });

    // 绘制棋盘
    function drawBoard() {
        // 清空画布
        ctx.fillStyle = colors.board;
        ctx.fillRect(0, 0, gameBoard.width, gameBoard.height);

        // 绘制网格线
        ctx.strokeStyle = colors.lines;
        ctx.lineWidth = 1;

        // 留出边距，使棋盘更美观
        const margin = gridSize / 2;

        for (let i = 0; i < 15; i++) {
            // 横线
            ctx.beginPath();
            ctx.moveTo(margin, margin + i * gridSize);
            ctx.lineTo(gameBoard.width - margin, margin + i * gridSize);
            ctx.stroke();

            // 竖线
            ctx.beginPath();
            ctx.moveTo(margin + i * gridSize, margin);
            ctx.lineTo(margin + i * gridSize, gameBoard.height - margin);
            ctx.stroke();
        }
        
        // 绘制天元和星位
        const starPoints = [
            [3, 3], [3, 7], [3, 11],
            [7, 3], [7, 7], [7, 11],
            [11, 3], [11, 7], [11, 11]
        ];
        
        starPoints.forEach(([row, col]) => {
            ctx.beginPath();
            ctx.arc(margin + col * gridSize, margin + row * gridSize, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#000';
            ctx.fill();
        });

        // 绘制棋子
        for (let row = 0; row < 15; row++) {
            for (let col = 0; col < 15; col++) {
                if (gameState.board[row][col] === 1) {
                    drawPiece(row, col, colors.redPiece);
                } else if (gameState.board[row][col] === 2) {
                    drawPiece(row, col, colors.bluePiece);
                }
            }
        }
    }

    // 绘制棋子
    function drawPiece(row, col, color) {
        const margin = gridSize / 2;
        const x = margin + col * gridSize;
        const y = margin + row * gridSize;
        const radius = gridSize * 0.4;

        // 棋子阴影
        ctx.beginPath();
        ctx.arc(x + 2, y + 2, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fill();
        
        // 棋子本体
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        
        // 添加高光效果
        ctx.beginPath();
        ctx.arc(x - radius / 3, y - radius / 3, radius / 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
    }

    // 更新游戏状态显示
    function updateGameInfo() {
        roomIdDisplay.textContent = gameState.roomId;
        
        const roleText = gameState.playerRole === 1 ? '红方' : '蓝方';
        playerRole.textContent = `您的角色: ${roleText}`;
        
        const turnText = gameState.currentPlayer === 1 ? '红方' : '蓝方';
        currentTurn.textContent = `当前回合: ${turnText}`;
        
        if (gameState.gameOver) {
            const winnerText = gameState.winner === gameState.playerRole ? '您赢了!' : '您输了!';
            gameStatus.textContent = winnerText;
            gameStatus.style.color = gameState.winner === 1 ? colors.redPiece : colors.bluePiece;
            restartBtn.style.display = 'inline-block';
        } else {
            gameStatus.textContent = gameState.statusMessage || '';
            restartBtn.style.display = gameState.gameOver ? 'inline-block' : 'none';
        }
    }

    // 当前悬停位置
    const hoverPosition = {
        row: -1,
        col: -1
    };
    
    // 处理玩家点击/触摸棋盘
    function handleBoardInteraction(e) {
        if (gameState.gameOver || gameState.currentPlayer !== gameState.playerRole) {
            return;
        }
        
        // 防止事件冒泡和默认行为
        e.preventDefault();
        
        const rect = gameBoard.getBoundingClientRect();
        
        // 获取点击/触摸坐标
        let clientX, clientY;
        
        if (e.type.startsWith('touch')) {
            // 触摸事件
            const touch = e.type === 'touchend' ? e.changedTouches[0] : e.touches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            // 鼠标事件
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        // 计算相对于棋盘的坐标
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        
        const margin = gridSize / 2;
        
        // 找到最近的交叉点
        let col = Math.round((x - margin) / gridSize);
        let row = Math.round((y - margin) / gridSize);
        
        // 确保在棋盘范围内
        if (col < 0) col = 0;
        if (col > 14) col = 14;
        if (row < 0) row = 0;
        if (row > 14) row = 14;
        
        // 更新悬停位置并重绘棋盘
        if (hoverPosition.row !== row || hoverPosition.col !== col) {
            hoverPosition.row = row;
            hoverPosition.col = col;
            drawBoardWithHover();
        }
        
        // 在触摸结束或点击时才发送落子请求
        if (e.type === 'click' || e.type === 'touchend') {
            if (gameState.board[row][col] === 0) {
                socket.emit('make_move', { row, col });
                // 重置悬停位置
                hoverPosition.row = -1;
                hoverPosition.col = -1;
            }
        }
    }
    
    // 绘制棋盘和悬停标记
    function drawBoardWithHover() {
        // 先绘制基本棋盘
        drawBoard();
        
        // 绘制最后一步棋的标记框
        if (gameState.lastMove) {
            const margin = gridSize / 2;
            const x = margin + gameState.lastMove.col * gridSize;
            const y = margin + gameState.lastMove.row * gridSize;
            
            // 绘制方框标记最后一步棋
            ctx.beginPath();
            const squareSize = gridSize * 0.5;
            ctx.rect(x - squareSize / 2, y - squareSize / 2, squareSize, squareSize);
            ctx.strokeStyle = '#00FF00'; // 使用绿色标记最后一步棋
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        
        // 如果有有效的悬停位置，绘制悬停标记
        if (hoverPosition.row >= 0 && hoverPosition.col >= 0 && 
            gameState.board[hoverPosition.row][hoverPosition.col] === 0) {
            const margin = gridSize / 2;
            const x = margin + hoverPosition.col * gridSize;
            const y = margin + hoverPosition.row * gridSize;
            
            // 绘制半透明的棋子标记
            ctx.beginPath();
            ctx.arc(x, y, gridSize * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = gameState.playerRole === 1 ? 
                'rgba(255, 0, 0, 0.3)' : 'rgba(0, 0, 255, 0.3)';
            ctx.fill();
            
            // 绘制边框
            ctx.beginPath();
            ctx.arc(x, y, gridSize * 0.4, 0, Math.PI * 2);
            ctx.strokeStyle = gameState.playerRole === 1 ? colors.redPiece : colors.bluePiece;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
    
    // 添加点击和触摸事件监听器
    gameBoard.addEventListener('click', handleBoardInteraction);
    gameBoard.addEventListener('touchstart', handleBoardInteraction);
    gameBoard.addEventListener('touchmove', handleBoardInteraction);
    gameBoard.addEventListener('touchend', handleBoardInteraction);
    gameBoard.addEventListener('mousemove', handleBoardInteraction);
    
    // 鼠标离开棋盘时清除悬停标记
    gameBoard.addEventListener('mouseleave', () => {
        hoverPosition.row = -1;
        hoverPosition.col = -1;
        drawBoardWithHover();
    });
    
    // 防止移动端缩放和滚动问题
    gameBoard.addEventListener('touchmove', (e) => {
        e.preventDefault();
    }, { passive: false });

    // Socket.IO 事件处理
    socket.on('room_created', (data) => {
        gameState.roomId = data.room_id;
        gameState.playerId = data.player_id;
        gameState.playerRole = data.role;
        
        welcomeScreen.style.display = 'none';
        gameScreen.style.display = 'block';
        
        // 重新调整棋盘大小并绘制
        resizeCanvas();
        drawBoardWithHover();
        updateGameInfo();
    });
    
    socket.on('room_joined', (data) => {
        gameState.roomId = data.room_id;
        gameState.playerId = data.player_id;
        gameState.playerRole = data.role;
        
        welcomeScreen.style.display = 'none';
        gameScreen.style.display = 'block';
        
        // 重新调整棋盘大小并绘制
        resizeCanvas();
        drawBoardWithHover();
        updateGameInfo();
    });
    
    socket.on('update_board', (data) => {
        gameState.board = data.board;
        gameState.currentPlayer = data.current_player;
        
        drawBoardWithHover();
        updateGameInfo();
    });

    socket.on('move_made', (data) => {
        gameState.board[data.row][data.col] = data.player;
        gameState.currentPlayer = data.next_player;
        // 记录最后一步棋的位置
        gameState.lastMove = {
            row: data.row,
            col: data.col,
            player: data.player
        };
        
        drawBoardWithHover();
        updateGameInfo();
    });

    socket.on('game_over', (data) => {
        gameState.gameOver = true;
        gameState.winner = data.winner;
        
        updateGameInfo();
    });
    
    // 处理重新开始游戏请求
    socket.on('restart_requested', (data) => {
        const playerRoleText = data.player_role === 1 ? '红方' : '蓝方';
        gameState.statusMessage = `${data.player_name}(${playerRoleText}) 请求重新开始游戏`;
        updateGameInfo();
    });
    
    // 处理游戏重新开始
    socket.on('game_restarted', (data) => {
        // 重置游戏状态
        gameState.board = Array(15).fill().map(() => Array(15).fill(0));
        gameState.currentPlayer = data.current_player;
        gameState.gameOver = false;
        gameState.winner = null;
        gameState.lastMove = null; // 清除最后一步棋的记录
        gameState.statusMessage = '游戏已重新开始！';
        
        // 重绘棋盘
        drawBoardWithHover();
        updateGameInfo();
        
        // 3秒后清除状态消息
        setTimeout(() => {
            gameState.statusMessage = '';
            updateGameInfo();
        }, 3000);
    });
    
    // 处理惜棋请求
    socket.on('undo_requested', (data) => {
        console.log('收到惜棋请求:', data, '当前玩家角色:', gameState.playerRole);
        
        // 如果是对方发起的惜棋请求，显示确认对话框
        if (data.player_role !== gameState.playerRole) {
            const playerRoleText = data.player_role === 1 ? '红方' : '蓝方';
            undoMessage.textContent = `${data.player_name}(${playerRoleText}) 请求惜棋，是否同意？`;
            undoConfirmation.style.display = 'block';
            console.log('显示惜棋确认对话框');
        }
        
        // 更新游戏状态信息
        if (data.player_role === gameState.playerRole) {
            gameState.statusMessage = '已发送惜棋请求，等待对方同意...';
        } else {
            gameState.statusMessage = `${data.player_name} 请求惜棋`;
        }
        updateGameInfo();
    });
    
    // 处理惜棋被同意
    socket.on('undo_approved', (data) => {
        console.log('收到惜棋被同意事件:', data);
        console.log('当前棋盘状态:', JSON.stringify(gameState.board));
        console.log('将清除棋子坐标:', data.row, data.col);
        
        // 先清除棋盘上的棋子
        if (data.row >= 0 && data.row < 15 && data.col >= 0 && data.col < 15) {
            gameState.board[data.row][data.col] = 0; // 清除棋子
            console.log('清除棋子后的棋盘状态:', JSON.stringify(gameState.board[data.row][data.col]));
        } else {
            console.error('无效的棋子坐标:', data.row, data.col);
        }
        
        // 更新游戏状态
        gameState.currentPlayer = data.current_player;
        gameState.lastMove = null; // 清除最后一步棋的记录，因为已经撤销
        gameState.statusMessage = `${data.player_name} 的惜棋请求已被同意`;
        
        // 隐藏确认对话框
        undoConfirmation.style.display = 'none';
        
        // 强制重绘棋盘
        ctx.clearRect(0, 0, gameBoard.width, gameBoard.height);
        drawBoardWithHover();
        updateGameInfo();
        
        console.log('重绘棋盘完成');
        
        // 3秒后清除状态消息
        setTimeout(() => {
            gameState.statusMessage = '';
            updateGameInfo();
        }, 3000);
    });
    
    // 处理惜棋被拒绝
    socket.on('undo_rejected', (data) => {
        // 更新游戏状态信息
        gameState.statusMessage = `${data.player_name} 的惜棋请求被拒绝`;
        
        // 隐藏确认对话框
        undoConfirmation.style.display = 'none';
        
        // 更新游戏信息
        updateGameInfo();
        
        // 3秒后清除状态消息
        setTimeout(() => {
            gameState.statusMessage = '';
            updateGameInfo();
        }, 3000);
    });

    socket.on('player_joined', (data) => {
        gameState.statusMessage = `${data.player_name} 加入了游戏`;
        updateGameInfo();
        setTimeout(() => {
            if (gameState.statusMessage === `${data.player_name} 加入了游戏`) {
                gameState.statusMessage = '';
                updateGameInfo();
            }
        }, 3000);
    });

    socket.on('player_disconnected', (data) => {
        gameState.statusMessage = `${data.player_name} 断开了连接，等待重连...`;
        updateGameInfo();
    });
    
    socket.on('player_reconnected', (data) => {
        gameState.statusMessage = `${data.player_name} 重新连接了游戏`;
        updateGameInfo();
        setTimeout(() => {
            if (gameState.statusMessage === `${data.player_name} 重新连接了游戏`) {
                gameState.statusMessage = '';
                updateGameInfo();
            }
        }, 3000);
    });
    
    socket.on('room_rejoined', (data) => {
        // 更新游戏状态
        gameState.board = data.board;
        gameState.currentPlayer = data.current_player;
        gameState.gameOver = data.game_over;
        
        // 如果有最后一步棋的信息，更新它
        if (data.last_move) {
            gameState.lastMove = data.last_move;
        }
        
        // 重绘棋盘
        drawBoardWithHover();
        updateGameInfo();
        
        gameState.statusMessage = '成功重新连接到游戏';
        updateGameInfo();
        
        setTimeout(() => {
            if (gameState.statusMessage === '成功重新连接到游戏') {
                gameState.statusMessage = '';
                updateGameInfo();
            }
        }, 3000);
    });

    socket.on('error', (data) => {
        alert(data.message);
    });
});
