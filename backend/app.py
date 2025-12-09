"""
Flask Backend API for Pigment-to-Order Matcher
Matches pigments to the closest customer orders
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler
from sklearn.metrics.pairwise import cosine_similarity
import os

app = Flask(__name__)
app.secret_key = 'pigment-matcher-secret-key-2024'
CORS(app, supports_credentials=True)

# Upload folder
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# User credentials
USER_CREDENTIALS = {
    'Akash': {'password': 'a123', 'type': 'user', 'name': 'Akash'},
    'Anirudh': {'password': 'a456', 'type': 'user', 'name': 'Anirudh'},
    'Sanjay': {'password': 's789', 'type': 'user', 'name': 'Sanjay'},
    'Sushant': {'password': 's123', 'type': 'user', 'name': 'Sushant'},
    'Naina': {'password': 'n123', 'type': 'user', 'name': 'Naina'},
    'admin': {'password': 'admin123', 'type': 'admin', 'name': 'Administrator'},
}

# Global storage for databases
databases = {
    'pigments': None,
    'orders': None
}


def lab_to_hex(L, a, b):
    """Convert L*a*b* to HEX color."""
    y = (L + 16) / 116
    x = a / 500 + y
    z = y - b / 200
    
    def f_inv(t):
        if t > 0.206893:
            return t ** 3
        else:
            return (t - 16/116) / 7.787
    
    X = 95.047 * f_inv(x)
    Y = 100.000 * f_inv(y)
    Z = 108.883 * f_inv(z)
    
    X, Y, Z = X/100, Y/100, Z/100
    R = X * 3.2406 + Y * -1.5372 + Z * -0.4986
    G = X * -0.9689 + Y * 1.8758 + Z * 0.0415
    B = X * 0.0557 + Y * -0.2040 + Z * 1.0570
    
    def gamma_correct(c):
        if c > 0.0031308:
            return 1.055 * (c ** (1/2.4)) - 0.055
        else:
            return 12.92 * c
    
    R = max(0, min(1, gamma_correct(R)))
    G = max(0, min(1, gamma_correct(G)))
    B = max(0, min(1, gamma_correct(B)))
    
    return '#{:02x}{:02x}{:02x}'.format(int(R*255), int(G*255), int(B*255))


def get_delta_e_interpretation(delta_e):
    """Get interpretation of Delta E value."""
    if delta_e < 1:
        return "Imperceptible", "Not perceptible by human eye"
    elif delta_e < 2:
        return "Very Slight", "Perceptible through close observation"
    elif delta_e < 3.5:
        return "Noticeable", "Perceptible at a glance"
    elif delta_e < 5:
        return "Significant", "Clearly noticeable difference"
    elif delta_e < 10:
        return "Large", "Colors are clearly different"
    else:
        return "Very Large", "Colors are very different"


def get_angular_distance_interpretation(angle_deg):
    """Get interpretation of angular distance."""
    if angle_deg < 5:
        return "Excellent", "Almost identical color direction"
    elif angle_deg < 10:
        return "Very Good", "Very similar hue direction"
    elif angle_deg < 20:
        return "Good", "Similar color family"
    elif angle_deg < 45:
        return "Moderate", "Related but noticeably different hue"
    else:
        return "Poor", "Different color direction"


def generate_sample_pigments():
    """Generate sample pigment database with inventory."""
    np.random.seed(42)
    n_samples = 50
    
    L_values = np.random.uniform(20, 95, n_samples)
    a_values = np.random.uniform(-60, 60, n_samples)
    b_values = np.random.uniform(-60, 60, n_samples)
    tonnage_values = np.random.uniform(5, 100, n_samples)
    
    data = []
    for i, (l, a, b, tonnage) in enumerate(zip(L_values, a_values, b_values, tonnage_values)):
        data.append({
            'PigmentID': f'PIG-{str(i+1).zfill(4)}',
            'L': round(l, 2),
            'a': round(a, 2),
            'b': round(b, 2),
            'AvailableTonnage': round(tonnage, 2),
            'HexColor': lab_to_hex(l, a, b)
        })
    
    return pd.DataFrame(data)


def generate_sample_orders():
    """Generate sample customer orders with required tonnage."""
    np.random.seed(123)
    n_orders = 30
    
    customer_names = ['Acme Corp', 'Global Industries', 'Tech Solutions', 'Prime Manufacturing', 
                      'Elite Products', 'Quality Goods', 'Master Coatings', 'Supreme Paints',
                      'ColorMax', 'PigmentPro', 'Industrial Colors', 'Custom Shades']
    
    data = []
    for i in range(n_orders):
        l = round(np.random.uniform(25, 90), 2)
        a = round(np.random.uniform(-50, 50), 2)
        b = round(np.random.uniform(-50, 50), 2)
        data.append({
            'OrderID': f'ORD-2024-{str(i+1).zfill(4)}',
            'CustomerName': np.random.choice(customer_names),
            'L': l,
            'a': a,
            'b': b,
            'RequiredTonnage': round(np.random.uniform(2, 40), 2),
            'Priority': np.random.choice(['High', 'Medium', 'Low']),
            'HexColor': lab_to_hex(l, a, b)
        })
    
    return pd.DataFrame(data)


def load_default_databases():
    """Load default databases."""
    possible_pigment_files = ['pigments.xlsx', 'uploads/pigments.xlsx']
    possible_order_files = ['orders.xlsx', 'uploads/orders.xlsx']
    
    # Load pigment database
    pigment_loaded = False
    for pigment_file in possible_pigment_files:
        if os.path.exists(pigment_file):
            try:
                databases['pigments'] = pd.read_excel(pigment_file)
                if 'PigmentID' not in databases['pigments'].columns:
                    databases['pigments']['PigmentID'] = [f'PIG-{str(i+1).zfill(4)}' for i in range(len(databases['pigments']))]
                if 'HexColor' not in databases['pigments'].columns:
                    databases['pigments']['HexColor'] = databases['pigments'].apply(
                        lambda row: lab_to_hex(row['L'], row['a'], row['b']), axis=1
                    )
                print(f"Loaded pigment database: {len(databases['pigments'])} records")
                pigment_loaded = True
                break
            except Exception as e:
                print(f"Error loading {pigment_file}: {e}")
    
    if not pigment_loaded:
        print("Generating sample pigment database")
        databases['pigments'] = generate_sample_pigments()
    
    # Load orders database
    orders_loaded = False
    for orders_file in possible_order_files:
        if os.path.exists(orders_file):
            try:
                databases['orders'] = pd.read_excel(orders_file)
                if 'HexColor' not in databases['orders'].columns:
                    databases['orders']['HexColor'] = databases['orders'].apply(
                        lambda row: lab_to_hex(row['L'], row['a'], row['b']), axis=1
                    )
                print(f"Loaded orders database: {len(databases['orders'])} records")
                orders_loaded = True
                break
            except Exception as e:
                print(f"Error loading {orders_file}: {e}")
    
    if not orders_loaded:
        print("Generating sample orders database")
        databases['orders'] = generate_sample_orders()


# Load databases on startup
load_default_databases()


@app.route('/api/login', methods=['POST'])
def login():
    """Handle user login."""
    data = request.json
    username = data.get('username', '')
    password = data.get('password', '')
    
    if username in USER_CREDENTIALS:
        if USER_CREDENTIALS[username]['password'] == password:
            user_info = {
                'username': username,
                'name': USER_CREDENTIALS[username]['name'],
                'type': USER_CREDENTIALS[username]['type']
            }
            return jsonify({'success': True, 'user': user_info})
    
    return jsonify({'success': False, 'message': 'Invalid credentials'}), 401


@app.route('/api/logout', methods=['POST'])
def logout():
    """Handle user logout."""
    return jsonify({'success': True})


@app.route('/api/database/pigments', methods=['GET'])
def get_pigments():
    """Get pigment database."""
    if databases['pigments'] is not None:
        return jsonify({
            'success': True,
            'data': databases['pigments'].to_dict('records'),
            'count': len(databases['pigments'])
        })
    return jsonify({'success': False, 'message': 'No database loaded'}), 404


@app.route('/api/database/orders', methods=['GET'])
def get_orders():
    """Get orders database."""
    if databases['orders'] is not None:
        return jsonify({
            'success': True,
            'data': databases['orders'].to_dict('records'),
            'count': len(databases['orders'])
        })
    return jsonify({'success': False, 'message': 'No orders loaded'}), 404


@app.route('/api/database/upload/pigments', methods=['POST'])
def upload_pigments():
    """Upload pigment database."""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename.endswith(('.xlsx', '.xls')):
        try:
            df = pd.read_excel(file)
            
            required_cols = ['L', 'a', 'b', 'AvailableTonnage']
            missing_cols = [col for col in required_cols if col not in df.columns]
            if missing_cols:
                return jsonify({
                    'success': False, 
                    'message': f'Missing required columns: {", ".join(missing_cols)}'
                }), 400
            
            if 'PigmentID' not in df.columns:
                df['PigmentID'] = [f'PIG-{str(i+1).zfill(4)}' for i in range(len(df))]
            
            df['HexColor'] = df.apply(lambda row: lab_to_hex(row['L'], row['a'], row['b']), axis=1)
            databases['pigments'] = df
            
            return jsonify({'success': True, 'count': len(df)})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 400
    
    return jsonify({'success': False, 'message': 'Invalid file format'}), 400


@app.route('/api/database/upload/orders', methods=['POST'])
def upload_orders():
    """Upload orders database."""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename.endswith(('.xlsx', '.xls')):
        try:
            df = pd.read_excel(file)
            
            required_cols = ['L', 'a', 'b', 'RequiredTonnage']
            missing_cols = [col for col in required_cols if col not in df.columns]
            if missing_cols:
                return jsonify({
                    'success': False, 
                    'message': f'Missing required columns: {", ".join(missing_cols)}'
                }), 400
            
            if 'OrderID' not in df.columns:
                df['OrderID'] = [f'ORD-2024-{str(i+1).zfill(4)}' for i in range(len(df))]
            if 'CustomerName' not in df.columns:
                df['CustomerName'] = 'Unknown Customer'
            if 'Priority' not in df.columns:
                df['Priority'] = 'Medium'
            
            df['HexColor'] = df.apply(lambda row: lab_to_hex(row['L'], row['a'], row['b']), axis=1)
            databases['orders'] = df
            
            return jsonify({'success': True, 'count': len(df)})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 400
    
    return jsonify({'success': False, 'message': 'Invalid file format'}), 400


@app.route('/api/match/pigment-to-orders', methods=['POST'])
def match_pigment_to_orders():
    """Find the 3 closest customer orders for a selected pigment."""
    data = request.json
    pigment_id = data.get('pigmentId')
    
    if databases['pigments'] is None or databases['orders'] is None:
        return jsonify({'success': False, 'message': 'Databases not loaded'}), 404
    
    # Get the selected pigment
    pigment = databases['pigments'][databases['pigments']['PigmentID'] == pigment_id]
    if len(pigment) == 0:
        return jsonify({'success': False, 'message': 'Pigment not found'}), 404
    
    pigment_data = pigment.iloc[0]
    pigment_lab = [float(pigment_data['L']), float(pigment_data['a']), float(pigment_data['b'])]
    available_tonnage = float(pigment_data['AvailableTonnage'])
    
    # Calculate matches using all three methods
    euclidean_matches = calculate_euclidean_matches(pigment_lab, databases['orders'])
    cosine_matches = calculate_cosine_matches(pigment_lab, databases['orders'])
    knn_matches = calculate_knn_matches(pigment_lab, databases['orders'])
    
    # Analyze consensus
    consensus = analyze_consensus(euclidean_matches, cosine_matches, knn_matches)
    
    # Generate production recommendation
    production_recommendation = generate_production_recommendation(
        pigment_data.to_dict(),
        consensus[:3],
        available_tonnage
    )
    
    return jsonify({
        'success': True,
        'pigment': {
            'id': pigment_data['PigmentID'],
            'L': float(pigment_data['L']),
            'a': float(pigment_data['a']),
            'b': float(pigment_data['b']),
            'hex': pigment_data['HexColor'],
            'availableTonnage': available_tonnage
        },
        'euclidean': euclidean_matches,
        'cosine': cosine_matches,
        'knn': knn_matches,
        'consensus': consensus,
        'productionRecommendation': production_recommendation
    })


def calculate_euclidean_matches(pigment_lab, orders_db, n_matches=3):
    """Calculate Euclidean distance matches from pigment to orders."""
    order_values = orders_db[['L', 'a', 'b']].values.astype(float)
    pigment_array = np.array(pigment_lab).reshape(1, -1)
    
    distances = np.sqrt(np.sum((order_values - pigment_array) ** 2, axis=1))
    closest_indices = np.argsort(distances)[:n_matches]
    
    results = []
    for rank, idx in enumerate(closest_indices, 1):
        delta_e = float(distances[idx])
        match_pct = float(100 * np.exp(-delta_e / 10))
        interpretation, description = get_delta_e_interpretation(delta_e)
        
        order = orders_db.iloc[idx]
        results.append({
            'rank': rank,
            'orderId': str(order.get('OrderID', f'ORD-{idx}')),
            'customerName': str(order.get('CustomerName', 'Unknown')),
            'L': float(order['L']),
            'a': float(order['a']),
            'b': float(order['b']),
            'hexColor': str(order.get('HexColor', lab_to_hex(order['L'], order['a'], order['b']))),
            'requiredTonnage': float(order.get('RequiredTonnage', 0)),
            'priority': str(order.get('Priority', 'Medium')),
            'deltaE': round(delta_e, 3),
            'matchPercentage': round(match_pct, 1),
            'interpretation': interpretation,
            'description': description
        })
    
    return results


def calculate_cosine_matches(pigment_lab, orders_db, n_matches=3):
    """Calculate Cosine similarity matches from pigment to orders."""
    order_values = orders_db[['L', 'a', 'b']].values.astype(float)
    pigment_array = np.array(pigment_lab).reshape(1, -1)
    
    similarities = cosine_similarity(pigment_array, order_values)[0]
    closest_indices = np.argsort(similarities)[::-1][:n_matches]
    euclidean_distances = np.sqrt(np.sum((order_values - pigment_array) ** 2, axis=1))
    
    results = []
    for rank, idx in enumerate(closest_indices, 1):
        similarity = float(similarities[idx])
        similarity_clamped = np.clip(similarity, -1, 1)
        angular_distance = float(np.arccos(similarity_clamped) * 180 / np.pi)
        euclidean_dist = float(euclidean_distances[idx])
        interpretation, description = get_angular_distance_interpretation(angular_distance)
        
        order = orders_db.iloc[idx]
        results.append({
            'rank': rank,
            'orderId': str(order.get('OrderID', f'ORD-{idx}')),
            'customerName': str(order.get('CustomerName', 'Unknown')),
            'L': float(order['L']),
            'a': float(order['a']),
            'b': float(order['b']),
            'hexColor': str(order.get('HexColor', lab_to_hex(order['L'], order['a'], order['b']))),
            'requiredTonnage': float(order.get('RequiredTonnage', 0)),
            'priority': str(order.get('Priority', 'Medium')),
            'similarity': round(similarity, 4),
            'angularDistance': round(angular_distance, 2),
            'euclideanDistance': round(euclidean_dist, 2),
            'interpretation': interpretation,
            'description': description
        })
    
    return results


def calculate_knn_matches(pigment_lab, orders_db, n_matches=3):
    """Calculate KNN matches from pigment to orders."""
    order_values = orders_db[['L', 'a', 'b']].values.astype(float)
    pigment_array = np.array(pigment_lab).reshape(1, -1)
    
    scaler = StandardScaler()
    orders_scaled = scaler.fit_transform(order_values)
    pigment_scaled = scaler.transform(pigment_array)
    
    n_neighbors = min(n_matches, len(orders_db))
    knn = NearestNeighbors(n_neighbors=n_neighbors, metric='euclidean')
    knn.fit(orders_scaled)
    
    distances, indices = knn.kneighbors(pigment_scaled)
    raw_distances = np.sqrt(np.sum((order_values - pigment_array) ** 2, axis=1))
    
    results = []
    for rank, (i, idx) in enumerate(zip(range(len(indices[0])), indices[0]), 1):
        distance = float(distances[0][i])
        raw_dist = float(raw_distances[idx])
        match_pct = float(100 * np.exp(-distance / 2))
        
        order = orders_db.iloc[idx]
        results.append({
            'rank': rank,
            'orderId': str(order.get('OrderID', f'ORD-{idx}')),
            'customerName': str(order.get('CustomerName', 'Unknown')),
            'L': float(order['L']),
            'a': float(order['a']),
            'b': float(order['b']),
            'hexColor': str(order.get('HexColor', lab_to_hex(order['L'], order['a'], order['b']))),
            'requiredTonnage': float(order.get('RequiredTonnage', 0)),
            'priority': str(order.get('Priority', 'Medium')),
            'normalizedDistance': round(distance, 4),
            'rawDistance': round(raw_dist, 2),
            'matchPercentage': round(match_pct, 1)
        })
    
    return results


def analyze_consensus(euclidean_matches, cosine_matches, knn_matches):
    """Analyze consensus across methods for order matching."""
    all_orders = {}
    
    for match in euclidean_matches:
        order_id = match['orderId']
        if order_id not in all_orders:
            all_orders[order_id] = {
                'orderId': order_id,
                'customerName': match['customerName'],
                'L': match['L'],
                'a': match['a'],
                'b': match['b'],
                'hexColor': match['hexColor'],
                'requiredTonnage': match['requiredTonnage'],
                'priority': match['priority'],
                'euclideanRank': None,
                'cosineRank': None,
                'knnRank': None,
                'euclideanDeltaE': None,
                'cosineAngular': None,
                'knnDistance': None
            }
        all_orders[order_id]['euclideanRank'] = match['rank']
        all_orders[order_id]['euclideanDeltaE'] = match['deltaE']
    
    for match in cosine_matches:
        order_id = match['orderId']
        if order_id not in all_orders:
            all_orders[order_id] = {
                'orderId': order_id,
                'customerName': match['customerName'],
                'L': match['L'],
                'a': match['a'],
                'b': match['b'],
                'hexColor': match['hexColor'],
                'requiredTonnage': match['requiredTonnage'],
                'priority': match['priority'],
                'euclideanRank': None,
                'cosineRank': None,
                'knnRank': None,
                'euclideanDeltaE': None,
                'cosineAngular': None,
                'knnDistance': None
            }
        all_orders[order_id]['cosineRank'] = match['rank']
        all_orders[order_id]['cosineAngular'] = match['angularDistance']
    
    for match in knn_matches:
        order_id = match['orderId']
        if order_id not in all_orders:
            all_orders[order_id] = {
                'orderId': order_id,
                'customerName': match['customerName'],
                'L': match['L'],
                'a': match['a'],
                'b': match['b'],
                'hexColor': match['hexColor'],
                'requiredTonnage': match['requiredTonnage'],
                'priority': match['priority'],
                'euclideanRank': None,
                'cosineRank': None,
                'knnRank': None,
                'euclideanDeltaE': None,
                'cosineAngular': None,
                'knnDistance': None
            }
        all_orders[order_id]['knnRank'] = match['rank']
        all_orders[order_id]['knnDistance'] = match['normalizedDistance']
    
    results = []
    for order_id, data in all_orders.items():
        methods_matched = 0
        rank_sum = 0
        
        if data['euclideanRank'] is not None:
            methods_matched += 1
            rank_sum += data['euclideanRank']
        if data['cosineRank'] is not None:
            methods_matched += 1
            rank_sum += data['cosineRank']
        if data['knnRank'] is not None:
            methods_matched += 1
            rank_sum += data['knnRank']
        
        avg_rank = rank_sum / methods_matched if methods_matched > 0 else 999
        consensus_score = (methods_matched * 100) - avg_rank
        
        data['methodsMatched'] = methods_matched
        data['avgRank'] = round(avg_rank, 2)
        data['consensusScore'] = round(consensus_score, 2)
        
        results.append(data)
    
    results.sort(key=lambda x: x['consensusScore'], reverse=True)
    
    return results


def generate_production_recommendation(pigment, top_orders, available_tonnage):
    """Generate production recommendation based on inventory and order requirements."""
    total_required = sum(order['requiredTonnage'] for order in top_orders)
    can_fulfill_all = available_tonnage >= total_required
    
    fulfillment_details = []
    remaining_tonnage = available_tonnage
    
    for order in top_orders:
        required = order['requiredTonnage']
        
        if remaining_tonnage >= required:
            fulfill_amount = required
            remaining_tonnage -= required
            status = 'Full'
        elif remaining_tonnage > 0:
            fulfill_amount = remaining_tonnage
            remaining_tonnage = 0
            status = 'Partial'
        else:
            fulfill_amount = 0
            status = 'Cannot Fulfill'
        
        fulfillment_details.append({
            'orderId': order['orderId'],
            'customerName': order['customerName'],
            'required': required,
            'canFulfill': round(fulfill_amount, 2),
            'status': status,
            'priority': order['priority'],
            'fulfillmentPercentage': round((fulfill_amount / required) * 100, 1) if required > 0 else 0
        })
    
    shortage = max(0, total_required - available_tonnage)
    high_priority_orders = [o for o in top_orders if o['priority'] == 'High']
    high_priority_required = sum(o['requiredTonnage'] for o in high_priority_orders)
    
    if can_fulfill_all:
        recommendation_status = 'success'
        recommendation_text = f"Sufficient inventory to fulfill all {len(top_orders)} matched orders."
        action_items = [
            f"Available: {available_tonnage:.2f} tonnes",
            f"Total Required: {total_required:.2f} tonnes",
            f"Remaining after fulfillment: {available_tonnage - total_required:.2f} tonnes"
        ]
    elif available_tonnage > 0:
        recommendation_status = 'warning'
        recommendation_text = f"Partial fulfillment possible. Production of {shortage:.2f} tonnes recommended."
        action_items = [
            f"Available: {available_tonnage:.2f} tonnes",
            f"Total Required: {total_required:.2f} tonnes",
            f"Shortage: {shortage:.2f} tonnes",
            "Consider prioritizing high-priority orders first"
        ]
    else:
        recommendation_status = 'critical'
        recommendation_text = f"No inventory available. Production of {total_required:.2f} tonnes required."
        action_items = [
            f"Total production needed: {total_required:.2f} tonnes",
            "Prioritize based on order priority levels"
        ]
    
    return {
        'status': recommendation_status,
        'summary': recommendation_text,
        'availableTonnage': round(available_tonnage, 2),
        'totalRequired': round(total_required, 2),
        'shortage': round(shortage, 2),
        'canFulfillAll': can_fulfill_all,
        'fulfillmentDetails': fulfillment_details,
        'actionItems': action_items,
        'productionRecommendation': round(shortage * 1.1, 2) if shortage > 0 else 0,
        'highPriorityRequired': round(high_priority_required, 2)
    }


if __name__ == '__main__':
    print("=" * 50)
    print("Pigment-to-Order Matcher API")
    print("=" * 50)
    print(f"Pigments loaded: {len(databases['pigments']) if databases['pigments'] is not None else 0}")
    print(f"Orders loaded: {len(databases['orders']) if databases['orders'] is not None else 0}")
    print("=" * 50)
    app.run(debug=True, port=5000)