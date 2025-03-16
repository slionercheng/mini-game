from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import uuid
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)

# 配置Socket.IO以使用长连接
# ping_timeout要比ping_interval大，以确保有足够的时间处理ping请求
# 增加message_queue支持以确保消息可靠性
# 将ping_interval设置为2秒，以快速检测连接状态
socketio = SocketIO(
    app, 
    cors_allowed_origins="*",
    ping_timeout=10,  # 减少ping超时时间以更快检测断开连接
    ping_interval=2,  # 设置为2秒，以快速检测连接状态
    async_mode='eventlet',
    logger=True,
    engineio_logger=True
)

# 游戏房间
rooms = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/rooms')
def get_rooms():
    room_list = []
    for room_id, room in rooms.items():
        if len(room['players']) < 2:  # 只返回未满的房间
            room_list.append({
                'id': room_id,
                'players': len(room['players']),
                'created_at': room.get('created_at', '')
            })
    return {'rooms': room_list}

@socketio.on('create_room')
def create_room(data):
    room_id = str(uuid.uuid4())[:8]
    rooms[room_id] = {
        'players': {},
        'board': [[0 for _ in range(15)] for _ in range(15)],
        'current_player': 1,
        'game_over': False,
        'created_at': data.get('name', 'Player 1') + '的房间',
        'last_activity': time.time(),  # 记录房间最后活动时间
        'last_move': None,  # 记录最后一步棋
    }
    join_room(room_id)
    session['room'] = room_id
    player_id = str(uuid.uuid4())[:8]
    rooms[room_id]['players'][player_id] = {
        'id': player_id,
        'name': data.get('name', 'Player 1'),
        'role': 1,  # 1: 红色棋子, 2: 蓝色棋子
        'last_seen': time.time(),
        'connected': True
    }
    session['player_id'] = player_id
    emit('room_created', {'room_id': room_id, 'player_id': player_id, 'role': 1})

@socketio.on('join_room')
def handle_join_room(data):
    room_id = data['room_id']
    if room_id in rooms and len(rooms[room_id]['players']) < 2:
        join_room(room_id)
        session['room'] = room_id
        player_id = str(uuid.uuid4())[:8]
        
        # 记录玩家加入时间，用于连接状态跟踪
        rooms[room_id]['players'][player_id] = {
            'id': player_id,
            'name': data.get('name', 'Player 2'),
            'role': 2,
            'last_seen': time.time(),
            'connected': True
        }
        session['player_id'] = player_id
        emit('room_joined', {'room_id': room_id, 'player_id': player_id, 'role': 2})
        emit('player_joined', {'player_name': data.get('name', 'Player 2')}, room=room_id)
        # 向新加入的玩家发送当前游戏状态
        emit('update_board', {'board': rooms[room_id]['board'], 'current_player': rooms[room_id]['current_player']})
    else:
        emit('error', {'message': 'Room not found or full'})

@socketio.on('rejoin_room')
def handle_rejoin_room(data):
    room_id = data.get('room_id')
    player_id = data.get('player_id')
    
    if not room_id or not player_id:
        emit('error', {'message': '缺少房间ID或玩家ID'})
        return
        
    if room_id in rooms and player_id in rooms[room_id]['players']:
        # 重新加入房间
        join_room(room_id)
        session['room'] = room_id
        session['player_id'] = player_id
        
        # 更新玩家状态
        rooms[room_id]['players'][player_id]['last_seen'] = time.time()
        rooms[room_id]['players'][player_id]['connected'] = True
        
        # 发送当前游戏状态
        emit('room_rejoined', {
            'room_id': room_id, 
            'player_id': player_id, 
            'role': rooms[room_id]['players'][player_id]['role'],
            'board': rooms[room_id]['board'],
            'current_player': rooms[room_id]['current_player'],
            'game_over': rooms[room_id]['game_over']
        })
        
        # 通知房间其他玩家此玩家已重新连接
        player_name = rooms[room_id]['players'][player_id]['name']
        emit('player_reconnected', {'player_name': player_name}, room=room_id, include_self=False)
    else:
        emit('error', {'message': '房间或玩家不存在'})

@socketio.on('make_move')
def make_move(data):
    room_id = session.get('room')
    player_id = session.get('player_id')
    
    if not room_id or not player_id or room_id not in rooms:
        emit('error', {'message': 'Invalid room or player'})
        return
    
    room = rooms[room_id]
    if player_id not in room['players']:
        emit('error', {'message': 'Player not in room'})
        return
    
    player = room['players'][player_id]
    if room['current_player'] != player['role'] or room['game_over']:
        emit('error', {'message': 'Not your turn or game over'})
        return
    
    row, col = data['row'], data['col']
    if not (0 <= row < 15 and 0 <= col < 15) or room['board'][row][col] != 0:
        emit('error', {'message': 'Invalid move'})
        return
    
    # 记录最后一步棋
    room['last_move'] = {
        'row': row,
        'col': col,
        'player': player['role'],
        'previous_player': 3 - player['role']
    }
    
    room['board'][row][col] = player['role']
    
    # 检查是否获胜
    if check_winner(room['board'], row, col, player['role']):
        room['game_over'] = True
        emit('game_over', {'winner': player['role']}, room=room_id)
    else:
        room['current_player'] = 3 - room['current_player']  # 切换玩家 (1->2, 2->1)
    
    emit('move_made', {
        'row': row,
        'col': col,
        'player': player['role'],
        'next_player': room['current_player']
    }, room=room_id)

@socketio.on('disconnect')
def disconnect():
    room_id = session.get('room')
    player_id = session.get('player_id')
    
    if room_id and player_id and room_id in rooms and player_id in rooms[room_id]['players']:
        player_name = rooms[room_id]['players'][player_id]['name']
        leave_room(room_id)
        
        # 不立即删除玩家，而是标记为断开连接，等待可能的重连
        rooms[room_id]['players'][player_id]['connected'] = False
        rooms[room_id]['players'][player_id]['last_seen'] = time.time()
        
        # 通知房间其他玩家此玩家已断开连接
        emit('player_disconnected', {'player_name': player_name}, room=room_id)
        
        # 启动一个定时器，如果玩家在一定时间内没有重连，则删除玩家
        # 实际应用中可以使用定时任务，这里简化处理
        # 在真实应用中，可以使用后台任务或定时器定期检查并清理长时间断开连接的玩家
        
        # 如果房间中没有连接的玩家，则在一定时间后删除房间
        connected_players = [p for p in rooms[room_id]['players'].values() if p['connected']]
        if not connected_players:
            # 在真实应用中，应该使用定时器或后台任务
            # 这里为了演示直接设置一个过期时间
            rooms[room_id]['expire_at'] = time.time() + 300  # 5分钟后过期

def check_winner(board, row, col, player):
    directions = [(1, 0), (0, 1), (1, 1), (1, -1)]
    for dr, dc in directions:
        count = 1
        # 正向检查
        for i in range(1, 5):
            r, c = row + dr * i, col + dc * i
            if 0 <= r < 15 and 0 <= c < 15 and board[r][c] == player:
                count += 1
            else:
                break
        # 反向检查
        for i in range(1, 5):
            r, c = row - dr * i, col - dc * i
            if 0 <= r < 15 and 0 <= c < 15 and board[r][c] == player:
                count += 1
            else:
                break
        if count >= 5:
            return True
    return False

@socketio.on('restart_game')
def restart_game():
    room_id = session.get('room')
    player_id = session.get('player_id')
    
    if not room_id or not player_id or room_id not in rooms:
        emit('error', {'message': '无效的房间或玩家'})
        return
    
    room = rooms[room_id]
    if player_id not in room['players']:
        emit('error', {'message': '玩家不在房间中'})
        return
    
    # 记录请求重新开始的玩家
    player_role = room['players'][player_id]['role']
    player_name = room['players'][player_id]['name']
    
    # 如果是第一个请求重新开始的玩家
    if 'restart_requested' not in room:
        room['restart_requested'] = player_role
        emit('restart_requested', {'player_role': player_role, 'player_name': player_name}, room=room_id)
    # 如果是第二个请求重新开始的玩家，且不是同一个玩家
    elif room['restart_requested'] != player_role:
        # 重置游戏状态
        room['board'] = [[0 for _ in range(15)] for _ in range(15)]
        room['current_player'] = 1  # 红方先手
        room['game_over'] = False
        room['last_move'] = None  # 清除最后一步棋记录
        # 清除重新开始的请求
        room.pop('restart_requested', None)
        
        # 通知所有玩家游戏已重新开始
        emit('game_restarted', {'current_player': 1}, room=room_id)

@socketio.on('request_undo')
def request_undo():
    room_id = session.get('room')
    player_id = session.get('player_id')
    
    if not room_id or not player_id or room_id not in rooms:
        emit('error', {'message': '无效的房间或玩家'})
        return
    
    room = rooms[room_id]
    if player_id not in room['players']:
        emit('error', {'message': '玩家不在房间中'})
        return
    
    # 检查游戏是否已结束
    if room['game_over']:
        emit('error', {'message': '游戏已结束，无法惜棋'})
        return
    
    # 检查是否有最后一步棋可惜
    if not room['last_move']:
        emit('error', {'message': '没有可惜的棋'})
        return
    
    # 检查最后一步棋是否是该玩家的
    player_role = room['players'][player_id]['role']
    last_move = room['last_move']
    
    if last_move['player'] != player_role:
        emit('error', {'message': '只能惜自己的最后一步棋'})
        return
    
    # 记录请求惜棋的玩家
    room['undo_requested'] = {
        'player_id': player_id,
        'player_role': player_role,
        'last_move': last_move
    }
    
    player_name = room['players'][player_id]['name']
    
    # 通知房间中的所有玩家有惜棋请求
    print(f"发送惜棋请求: 玩家 {player_name}, 角色 {player_role}, 房间 {room_id}")
    emit('undo_requested', {
        'player_name': player_name,
        'player_role': player_role
    }, room=room_id, broadcast=True)

@socketio.on('approve_undo')
def approve_undo():
    room_id = session.get('room')
    player_id = session.get('player_id')
    
    if not room_id or not player_id or room_id not in rooms:
        emit('error', {'message': '无效的房间或玩家'})
        return
    
    room = rooms[room_id]
    if player_id not in room['players']:
        emit('error', {'message': '玩家不在房间中'})
        return
    
    # 检查是否有惜棋请求
    if 'undo_requested' not in room:
        emit('error', {'message': '没有惜棋请求'})
        return
    
    # 检查是否是对方玩家同意
    player_role = room['players'][player_id]['role']
    if player_role == room['undo_requested']['player_role']:
        emit('error', {'message': '只有对方玩家才能同意惜棋请求'})
        return
    
    # 执行惜棋操作
    last_move = room['undo_requested']['last_move']
    row, col = last_move['row'], last_move['col']
    
    # 获取请求惜棋的玩家名称和角色
    requester_id = room['undo_requested']['player_id']
    requester_name = room['players'][requester_id]['name']
    requester_role = room['undo_requested']['player_role']
    
    # 清除棋盘上的棋子
    print(f"惜棋前的棋盘状态: {room['board'][row][col]} at [{row}, {col}]")
    room['board'][row][col] = 0
    print(f"惜棋后的棋盘状态: {room['board'][row][col]} at [{row}, {col}]")
    
    # 切换玩家回合
    room['current_player'] = requester_role  # 返回到请求惜棋的玩家
    
    # 清除最后一步棋记录和惜棋请求
    room['last_move'] = None
    room.pop('undo_requested', None)
    
    # 通知所有玩家惜棋操作已执行
    print(f"惜棋请求被同意: 玩家 {requester_name}, 房间 {room_id}, 坐标 [{row}, {col}]")
    
    # 将棋盘状态发送给所有玩家
    emit('undo_approved', {
        'row': row,
        'col': col,
        'current_player': room['current_player'],
        'player_name': requester_name
    }, room=room_id, broadcast=True)

@socketio.on('reject_undo')
def reject_undo():
    room_id = session.get('room')
    player_id = session.get('player_id')
    
    if not room_id or not player_id or room_id not in rooms:
        emit('error', {'message': '无效的房间或玩家'})
        return
    
    room = rooms[room_id]
    if player_id not in room['players']:
        emit('error', {'message': '玩家不在房间中'})
        return
    
    # 检查是否有惜棋请求
    if 'undo_requested' not in room:
        emit('error', {'message': '没有惜棋请求'})
        return
    
    # 检查是否是对方玩家拒绝
    player_role = room['players'][player_id]['role']
    if player_role == room['undo_requested']['player_role']:
        emit('error', {'message': '只有对方玩家才能拒绝惜棋请求'})
        return
    
    # 清除惜棋请求
    requester_name = room['players'][room['undo_requested']['player_id']]['name']
    room.pop('undo_requested', None)
    
    # 通知所有玩家惜棋请求被拒绝
    print(f"惜棋请求被拒绝: 玩家 {requester_name}, 房间 {room_id}")
    emit('undo_rejected', {
        'player_name': requester_name
    }, room=room_id, broadcast=True)

# 清理过期的房间和断开连接的玩家
def cleanup_rooms():
    current_time = time.time()
    rooms_to_remove = []
    
    for room_id, room in rooms.items():
        # 检查房间是否过期
        if 'expire_at' in room and current_time > room['expire_at']:
            rooms_to_remove.append(room_id)
            continue
            
        # 检查断开连接的玩家
        players_to_remove = []
        for player_id, player in room['players'].items():
            if not player['connected'] and current_time - player['last_seen'] > 300:  # 5分钟未重连
                players_to_remove.append(player_id)
                
        # 删除断开连接超时的玩家
        for player_id in players_to_remove:
            del room['players'][player_id]
            
        # 如果房间没有玩家，标记为删除
        if not room['players']:
            rooms_to_remove.append(room_id)
    
    # 删除空房间
    for room_id in rooms_to_remove:
        if room_id in rooms:
            del rooms[room_id]

# 每60秒清理一次房间和玩家
@socketio.on('connect')
def handle_connect():
    socketio.start_background_task(target=background_cleanup)

def background_cleanup():
    while True:
        socketio.sleep(60)
        cleanup_rooms()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
