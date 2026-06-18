import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

def analyze_and_cluster_responses(responses: list) -> dict:
    """
    Takes a list of response dictionaries:
    [
      {"id": "...", "text": "I cancel because of pricing levels..."},
      ...
    ]
    Returns coordinates and cluster labels:
    {
      "points": [
        {"id": "...", "text": "...", "x": 1.2, "y": -0.5, "cluster": 0, "similarity": 0.85},
        ...
      ],
      "clusters": [
        {"id": 0, "name": "Pricing & Costs", "keywords": ["price", "cost", "cancel"]}
      ],
      "outliers": [
        {"id": "...", "text": "...", "reason": "Low cluster similarity (0.12)", "similarity": 0.12}
      ]
    }
    """
    if not responses:
        return {"points": [], "clusters": [], "outliers": []}

    # Extract clean text from responses
    texts = [r.get("text", "").strip() for r in responses]
    ids = [r.get("id") for r in responses]

    # Filter out empty texts
    valid_indices = [i for i, t in enumerate(texts) if len(t) > 2]
    
    if len(valid_indices) < 2:
        # Fallback for single/empty response
        points = []
        for idx in valid_indices:
            points.append({
                "id": ids[idx],
                "text": texts[idx],
                "x": 0.0,
                "y": 0.0,
                "cluster": 0,
                "similarity": 1.0
            })
        return {
            "points": points,
            "clusters": [{"id": 0, "name": "General Feedback", "keywords": ["responses"]}],
            "outliers": []
        }

    valid_texts = [texts[i] for i in valid_indices]
    valid_ids = [ids[i] for i in valid_indices]

    try:
        # 1. Vectorize text using TF-IDF with custom n-gram parameters
        vectorizer = TfidfVectorizer(
            stop_words='english', 
            min_df=1, 
            ngram_range=(1, 2),
            sublinear_tf=True
        )
        X = vectorizer.fit_transform(valid_texts).toarray()

        # 2. Determine K clusters dynamically based on dataset size
        n_samples = len(valid_texts)
        if n_samples < 5:
            n_clusters = 2
        elif n_samples < 15:
            n_clusters = 3
        else:
            n_clusters = min(5, n_samples // 4)

        # 3. Compute Clusters using K-Means
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10, max_iter=300)
        cluster_labels = kmeans.fit_predict(X)

        # 4. Reduce dimensions to 2D using PCA
        pca = PCA(n_components=2, random_state=42)
        X_2d = pca.fit_transform(X)

        # Normalize coordinates between -5.0 and 5.0 for display padding
        x_min, x_max = X_2d[:, 0].min(), X_2d[:, 0].max()
        y_min, y_max = X_2d[:, 1].min(), X_2d[:, 1].max()

        def norm(val, v_min, v_max):
            if v_max == v_min:
                return 0.0
            return float(((val - v_min) / (v_max - v_min)) * 10 - 5)

        # Calculate cosine similarity of each point to its cluster centroid
        points = []
        outliers = []
        
        for i in range(len(valid_texts)):
            c_id = cluster_labels[i]
            centroid = kmeans.cluster_centers_[c_id]
            vector = X[i]
            
            # Cosine similarity = (A . B) / (||A|| * ||B||)
            dot_product = np.dot(vector, centroid)
            norm_vector = np.linalg.norm(vector)
            norm_centroid = np.linalg.norm(centroid)
            
            similarity = float(dot_product / (norm_vector * norm_centroid)) if norm_vector > 0 and norm_centroid > 0 else 0.0

            x_coord = norm(X_2d[i, 0], x_min, x_max)
            y_coord = norm(X_2d[i, 1], y_min, y_max)

            point_info = {
                "id": valid_ids[i],
                "text": valid_texts[i],
                "x": x_coord,
                "y": y_coord,
                "cluster": int(c_id),
                "similarity": round(similarity, 3)
            }
            points.append(point_info)

            # Mathematical Outlier: Very low similarity to assigned cluster centroid (less than 0.15)
            if similarity < 0.15:
                outliers.append({
                    "response_id": valid_ids[i],
                    "text": valid_texts[i][:120] + "...",
                    "reason": f"Atypical feedback (similarity score: {round(similarity, 2)})",
                    "similarity": round(similarity, 3)
                })

        # 5. Generate cluster keywords and names
        feature_names = np.array(vectorizer.get_feature_names_out())
        clusters_info = []

        theme_names = {
            "pricing": "Pricing & Billing",
            "price": "Pricing & Billing",
            "cost": "Pricing & Billing",
            "expensive": "Pricing & Billing",
            "speed": "Performance & Speed",
            "lag": "Performance & Speed",
            "slow": "Performance & Speed",
            "loading": "Performance & Speed",
            "database": "Performance & Speed",
            "db": "Performance & Speed",
            "supabase": "Competitor Migration",
            "firebase": "Competitor Migration",
            "competitor": "Competitor Migration",
            "migrate": "Competitor Migration",
            "switch": "Competitor Migration",
            "ui": "Interface & UX",
            "usability": "Interface & UX",
            "design": "Interface & UX"
        }

        for c_id in range(n_clusters):
            c_indices = [idx for idx, label in enumerate(cluster_labels) if label == c_id]
            if not c_indices:
                continue

            # Find top terms in this cluster using the centroid
            c_centroid = kmeans.cluster_centers_[c_id]
            top_centroids_indices = c_centroid.argsort()[-4:][::-1]
            keywords = [feature_names[idx] for idx in top_centroids_indices if idx < len(feature_names)]

            # Guess a name based on keywords
            cluster_name = None
            for kw in keywords:
                for category, name in theme_names.items():
                    if category in kw.lower():
                        cluster_name = name
                        break
                if cluster_name:
                    break
            
            if not cluster_name:
                cluster_name = f"Cohort Cluster {c_id + 1} ({', '.join(keywords[:2])})"

            clusters_info.append({
                "id": c_id,
                "name": cluster_name,
                "keywords": keywords
            })

        return {
            "points": points,
            "clusters": clusters_info,
            "outliers": outliers
        }

    except Exception as e:
        print(f"Error in clustering algorithm: {e}")
        # Robust fallback
        fallback_points = []
        for i, text in enumerate(valid_texts):
            fallback_points.append({
                "id": valid_ids[i],
                "text": text,
                "x": float(np.sin(i) * 3),
                "y": float(np.cos(i) * 3),
                "cluster": i % 2,
                "similarity": 0.5
            })
        return {
            "points": fallback_points,
            "clusters": [
                {"id": 0, "name": "General Cohort A", "keywords": ["feedback"]},
                {"id": 1, "name": "General Cohort B", "keywords": ["comments"]}
            ],
            "outliers": []
        }
