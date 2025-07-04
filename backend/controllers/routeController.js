const axios = require('axios');
const { greedyTSP, dynamicProgrammingTSP } = require('../algorithms/tsp');
const { pool } = require('../config/database');

// Get weather information for a city
async function getWeatherInfo(city) {
    try {
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/weather?q=${city.name}&appid=${process.env.OPENWEATHERMAP_API_KEY}&units=metric`
        );

        return {
            temperature: response.data.main.temp,
            humidity: response.data.main.humidity,
            conditions: response.data.weather[0].main,
            description: response.data.weather[0].description
        };
    } catch (error) {
        console.error(`Error fetching weather for ${city.name}:`, error);
        return null;
    }
}

// Calculate route using specified algorithm
exports.calculateRoute = async (req, res) => {
    try {
        const { cities, algorithm } = req.body;
        const userId = req.user.userId;

        // Validate input
        if (!cities || !Array.isArray(cities) || cities.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'At least 2 cities are required'
            });
        }

        // Get weather information for all cities
        const weatherPromises = cities.map(city => getWeatherInfo(city));
        const weatherResults = await Promise.all(weatherPromises);

        // Add weather info to cities
        const citiesWithWeather = cities.map((city, index) => ({
            ...city,
            weather: weatherResults[index]
        }));

        // Calculate route
        const startTime = process.hrtime();
        const result = algorithm === 'dynamic' 
            ? dynamicProgrammingTSP(cities)
            : greedyTSP(cities);
        const endTime = process.hrtime(startTime);
        const executionTime = endTime[0] * 1000 + endTime[1] / 1000000; // Convert to milliseconds

        // Save route to database
        const [dbResult] = await pool.execute(
            `INSERT INTO routes (user_id, route_name, cities, total_distance, weather_conditions, algorithm_used, execution_time)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                req.body.routeName || 'Unnamed Route',
                JSON.stringify(citiesWithWeather),
                result.distance,
                JSON.stringify(weatherResults),
                algorithm,
                executionTime
            ]
        );

        res.json({
            success: true,
            route: {
                id: dbResult.insertId,
                path: result.path,
                distance: result.distance,
                weather: weatherResults,
                executionTime
            }
        });
    } catch (error) {
        console.error('Route calculation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error calculating route'
        });
    }
};

// Get user's route history
exports.getRouteHistory = async (req, res) => {
    try {
        const userId = req.user.userId;
        const [routes] = await pool.execute(
            'SELECT * FROM routes WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );

        res.json({
            success: true,
            routes: routes.map(route => ({
                ...route,
                cities: JSON.parse(route.cities),
                weather_conditions: JSON.parse(route.weather_conditions)
            }))
        });
    } catch (error) {
        console.error('Route history error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching route history'
        });
    }
};

// Delete a route
exports.deleteRoute = async (req, res) => {
    try {
        const { routeId } = req.params;
        const userId = req.user.userId;

        const [result] = await pool.execute(
            'DELETE FROM routes WHERE id = ? AND user_id = ?',
            [routeId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Route not found or unauthorized'
            });
        }

        res.json({
            success: true,
            message: 'Route deleted successfully'
        });
    } catch (error) {
        console.error('Route deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting route'
        });
    }
}; 