/**
 * ZeTheta Risk Engine - Tests & Benchmarks
 * ==========================================
 * Unit tests and performance benchmarks for the risk engine
 */

#include <iostream>
#include <iomanip>
#include <vector>
#include <random>
#include <thread>
#include <numeric>
#include "risk_engine.hpp"

using namespace zetheta::risk;

// ============ Test Utilities ============

#define TEST_ASSERT(cond, msg) do { \
    if (!(cond)) { \
        std::cerr << "FAIL: " << msg << " (" << __FILE__ << ":" << __LINE__ << ")\n"; \
        return false; \
    } \
} while(0)

#define TEST_CASE(name) std::cout << "Testing: " << name << "... "

// ============ Unit Tests ============

bool test_basic_order_check() {
    TEST_CASE("Basic order check");
    
    RiskEngine engine;
    engine.update_price("AAPL", FixedPrice(150.0));
    
    // Should pass
    auto result = engine.check_pre_trade("AAPL", true, 100, FixedPrice(150.0));
    TEST_ASSERT(result.passed, "Basic order should pass");
    TEST_ASSERT(result.violation == ViolationType::NONE, "Should have no violation");
    TEST_ASSERT(result.latency_ns > 0, "Should measure latency");
    
    std::cout << "PASS (latency: " << result.latency_ns << "ns)\n";
    return true;
}

bool test_position_limit() {
    TEST_CASE("Position limit enforcement");
    
    RiskLimits limits;
    limits.max_position_per_symbol = 1000;
    RiskEngine engine(limits);
    
    engine.update_price("AAPL", FixedPrice(150.0));
    engine.update_position("AAPL", 950);
    
    // Should pass - under limit
    auto result1 = engine.check_pre_trade("AAPL", true, 40, FixedPrice(150.0));
    TEST_ASSERT(result1.passed, "Under limit should pass");
    
    // Should fail - over limit
    auto result2 = engine.check_pre_trade("AAPL", true, 100, FixedPrice(150.0));
    TEST_ASSERT(!result2.passed, "Over limit should fail");
    TEST_ASSERT(result2.violation == ViolationType::POSITION_LIMIT, "Should be position limit violation");
    
    std::cout << "PASS\n";
    return true;
}

bool test_order_size_limit() {
    TEST_CASE("Order size limit");
    
    RiskLimits limits;
    limits.max_order_size = 500;
    RiskEngine engine(limits);
    
    // Should pass
    auto result1 = engine.check_pre_trade("AAPL", true, 500, FixedPrice(150.0));
    TEST_ASSERT(result1.passed, "At limit should pass");
    
    // Should fail
    auto result2 = engine.check_pre_trade("AAPL", true, 501, FixedPrice(150.0));
    TEST_ASSERT(!result2.passed, "Over limit should fail");
    TEST_ASSERT(result2.violation == ViolationType::MAX_ORDER_SIZE, "Should be order size violation");
    
    std::cout << "PASS\n";
    return true;
}

bool test_rate_limiting() {
    TEST_CASE("Rate limiting");
    
    RiskLimits limits;
    limits.max_orders_per_second = 10;
    limits.burst_allowance = 5;
    RiskEngine engine(limits);
    
    // Send burst of orders
    int passed = 0;
    for (int i = 0; i < 20; ++i) {
        auto result = engine.check_pre_trade("AAPL", true, 10, FixedPrice(150.0));
        if (result.passed) passed++;
    }
    
    // Token bucket should allow initial burst, then throttle
    // The burst allowance of 5 means we start with 5 tokens
    TEST_ASSERT(passed <= 10, "Rate limiter should throttle after burst");
    TEST_ASSERT(passed >= 3, "Should allow at least initial burst");
    
    std::cout << "PASS (allowed " << passed << "/20)\n";
    return true;
}

bool test_circuit_breaker() {
    TEST_CASE("Circuit breaker");
    
    RiskLimits limits;
    limits.circuit_breaker_threshold = 3;
    limits.max_order_size = 100;  // Low to trigger failures
    RiskEngine engine(limits);
    
    // Trigger failures
    for (int i = 0; i < 5; ++i) {
        engine.check_pre_trade("AAPL", true, 200, FixedPrice(150.0));  // Will fail
    }
    
    TEST_ASSERT(engine.circuit_state() == CircuitState::OPEN, "Circuit should be open");
    
    // Should reject due to circuit breaker
    auto result = engine.check_pre_trade("AAPL", true, 10, FixedPrice(150.0));
    TEST_ASSERT(!result.passed, "Should reject when circuit open");
    TEST_ASSERT(result.violation == ViolationType::CIRCUIT_BREAKER_OPEN, "Should be circuit breaker violation");
    
    std::cout << "PASS\n";
    return true;
}

bool test_daily_loss_limit() {
    TEST_CASE("Daily loss limit");
    
    RiskLimits limits;
    limits.daily_loss_limit = 10000 * FIXED_POINT_SCALE;
    RiskEngine engine(limits);
    
    engine.update_price("AAPL", FixedPrice(150.0));
    
    // Normal PnL - should pass
    engine.update_pnl(FixedPrice(-5000.0));
    auto result1 = engine.check_pre_trade("AAPL", true, 10, FixedPrice(150.0));
    TEST_ASSERT(result1.passed, "Under loss limit should pass");
    
    // Exceeded loss limit - should fail
    engine.update_pnl(FixedPrice(-15000.0));
    auto result2 = engine.check_pre_trade("AAPL", true, 10, FixedPrice(150.0));
    TEST_ASSERT(!result2.passed, "Over loss limit should fail");
    TEST_ASSERT(result2.violation == ViolationType::DAILY_LOSS_LIMIT, "Should be daily loss violation");
    
    std::cout << "PASS\n";
    return true;
}

bool test_emergency_stop() {
    TEST_CASE("Emergency stop");
    
    RiskEngine engine;
    
    // Normal operation
    auto result1 = engine.check_pre_trade("AAPL", true, 10, FixedPrice(150.0));
    TEST_ASSERT(result1.passed, "Normal operation should pass");
    
    // Emergency stop
    engine.emergency_stop();
    auto result2 = engine.check_pre_trade("AAPL", true, 10, FixedPrice(150.0));
    TEST_ASSERT(!result2.passed, "Emergency stop should reject");
    
    // Resume
    engine.resume_trading();
    auto result3 = engine.check_pre_trade("AAPL", true, 10, FixedPrice(150.0));
    TEST_ASSERT(result3.passed, "After resume should pass");
    
    std::cout << "PASS\n";
    return true;
}

bool test_challenge_presets() {
    TEST_CASE("Challenge presets");
    
    auto mm_limits = market_maker_limits();
    TEST_ASSERT(mm_limits.max_orders_per_second == 200, "Market maker rate");
    
    auto arb_limits = latency_arb_limits();
    TEST_ASSERT(arb_limits.max_orders_per_second == 500, "Arb rate");
    
    auto mom_limits = momentum_limits();
    TEST_ASSERT(mom_limits.max_position_per_symbol == 10000, "Momentum position");
    
    auto crash_limits = flash_crash_limits();
    TEST_ASSERT(crash_limits.rolling_drawdown_bps == 2000, "Flash crash drawdown");
    
    std::cout << "PASS\n";
    return true;
}

// ============ Benchmarks ============

void benchmark_latency() {
    std::cout << "\n=== Latency Benchmark ===\n";
    
    RiskEngine engine;
    engine.update_price("AAPL", FixedPrice(150.0));
    
    constexpr int WARMUP = 10000;
    constexpr int ITERATIONS = 100000;
    
    // Warmup
    for (int i = 0; i < WARMUP; ++i) {
        engine.check_pre_trade("AAPL", i % 2 == 0, 100, FixedPrice(150.0));
    }
    
    // Measure
    std::vector<uint64_t> latencies;
    latencies.reserve(ITERATIONS);
    
    for (int i = 0; i < ITERATIONS; ++i) {
        auto result = engine.check_pre_trade("AAPL", i % 2 == 0, 100, FixedPrice(150.0));
        latencies.push_back(result.latency_ns);
    }
    
    // Statistics
    std::sort(latencies.begin(), latencies.end());
    
    double avg = std::accumulate(latencies.begin(), latencies.end(), 0ULL) / 
                 static_cast<double>(ITERATIONS);
    uint64_t p50 = latencies[ITERATIONS / 2];
    uint64_t p95 = latencies[static_cast<size_t>(ITERATIONS * 0.95)];
    uint64_t p99 = latencies[static_cast<size_t>(ITERATIONS * 0.99)];
    uint64_t min_lat = latencies.front();
    uint64_t max_lat = latencies.back();
    
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "Iterations: " << ITERATIONS << "\n";
    std::cout << "Average:    " << avg << " ns\n";
    std::cout << "Median:     " << p50 << " ns\n";
    std::cout << "P95:        " << p95 << " ns\n";
    std::cout << "P99:        " << p99 << " ns\n";
    std::cout << "Min:        " << min_lat << " ns\n";
    std::cout << "Max:        " << max_lat << " ns\n";
    
    // Convert to microseconds for comparison
    std::cout << "\nIn microseconds:\n";
    std::cout << "Average: " << avg / 1000.0 << " μs\n";
    std::cout << "P99:     " << p99 / 1000.0 << " μs\n";
}

void benchmark_throughput() {
    std::cout << "\n=== Throughput Benchmark ===\n";
    
    RiskLimits limits;
    limits.max_orders_per_second = 1000000;  // Effectively unlimited for benchmark
    limits.max_orders_per_minute = 60000000;
    limits.burst_allowance = 1000000;
    RiskEngine engine(limits);
    
    engine.update_price("AAPL", FixedPrice(150.0));
    
    constexpr int ITERATIONS = 1000000;
    
    auto start = std::chrono::high_resolution_clock::now();
    
    for (int i = 0; i < ITERATIONS; ++i) {
        engine.check_pre_trade("AAPL", i % 2 == 0, 100, FixedPrice(150.0));
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
    
    double seconds = duration.count() / 1e6;
    double ops_per_sec = ITERATIONS / seconds;
    
    std::cout << "Iterations:   " << ITERATIONS << "\n";
    std::cout << "Duration:     " << duration.count() << " μs\n";
    std::cout << "Throughput:   " << std::fixed << std::setprecision(0) 
              << ops_per_sec << " checks/sec\n";
    std::cout << "              " << ops_per_sec / 1e6 << "M checks/sec\n";
}

void benchmark_multithread() {
    std::cout << "\n=== Multi-threaded Benchmark ===\n";
    
    RiskLimits limits;
    limits.max_orders_per_second = 10000000;
    limits.max_orders_per_minute = 600000000;
    limits.burst_allowance = 10000000;
    RiskEngine engine(limits);
    
    engine.update_price("AAPL", FixedPrice(150.0));
    engine.update_price("GOOGL", FixedPrice(2800.0));
    engine.update_price("MSFT", FixedPrice(380.0));
    
    constexpr int NUM_THREADS = 4;
    constexpr int ITERATIONS_PER_THREAD = 250000;
    
    std::vector<std::thread> threads;
    std::atomic<uint64_t> total_ops{0};
    std::vector<uint64_t> thread_latencies(NUM_THREADS);
    
    auto start = std::chrono::high_resolution_clock::now();
    
    for (int t = 0; t < NUM_THREADS; ++t) {
        threads.emplace_back([&, t]() {
            const char* symbols[] = {"AAPL", "GOOGL", "MSFT"};
            uint64_t total_lat = 0;
            
            for (int i = 0; i < ITERATIONS_PER_THREAD; ++i) {
                auto result = engine.check_pre_trade(
                    symbols[i % 3],
                    i % 2 == 0,
                    100,
                    FixedPrice(150.0)
                );
                total_lat += result.latency_ns;
                total_ops.fetch_add(1, std::memory_order_relaxed);
            }
            
            thread_latencies[t] = total_lat / ITERATIONS_PER_THREAD;
        });
    }
    
    for (auto& t : threads) {
        t.join();
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
    
    double seconds = duration.count() / 1e6;
    double ops_per_sec = total_ops.load() / seconds;
    uint64_t avg_thread_latency = std::accumulate(
        thread_latencies.begin(), thread_latencies.end(), 0ULL) / NUM_THREADS;
    
    std::cout << "Threads:      " << NUM_THREADS << "\n";
    std::cout << "Total ops:    " << total_ops.load() << "\n";
    std::cout << "Duration:     " << duration.count() << " μs\n";
    std::cout << "Throughput:   " << std::fixed << std::setprecision(0) 
              << ops_per_sec << " checks/sec\n";
    std::cout << "              " << ops_per_sec / 1e6 << "M checks/sec\n";
    std::cout << "Avg latency:  " << avg_thread_latency << " ns/check\n";
}

// ============ Main ============

int main(int argc, char* argv[]) {
    std::cout << "ZeTheta Risk Engine - Tests & Benchmarks\n";
    std::cout << "=========================================\n\n";
    
    bool run_benchmarks = (argc > 1 && std::string(argv[1]) == "--bench");
    
    // Run unit tests
    std::cout << "=== Unit Tests ===\n";
    
    int passed = 0;
    int failed = 0;
    
    auto run_test = [&](bool (*test)()) {
        if (test()) {
            passed++;
        } else {
            failed++;
        }
    };
    
    run_test(test_basic_order_check);
    run_test(test_position_limit);
    run_test(test_order_size_limit);
    run_test(test_rate_limiting);
    run_test(test_circuit_breaker);
    run_test(test_daily_loss_limit);
    run_test(test_emergency_stop);
    run_test(test_challenge_presets);
    
    std::cout << "\nResults: " << passed << "/" << (passed + failed) << " tests passed\n";
    
    // Run benchmarks if requested
    if (run_benchmarks) {
        benchmark_latency();
        benchmark_throughput();
        benchmark_multithread();
    } else {
        std::cout << "\nRun with --bench flag for performance benchmarks\n";
    }
    
    return failed > 0 ? 1 : 0;
}
