/**
 * ZeTheta High-Performance Risk Engine
 * =====================================
 * Sub-microsecond pre-trade risk checks for HFT matching engine
 * 
 * Features:
 * - Lock-free position tracking
 * - O(1) rate limiting with token bucket
 * - Fixed-point arithmetic for precision
 * - Cache-aligned data structures
 * - Compile-time configurable limits
 */

#pragma once

#include <atomic>
#include <chrono>
#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <optional>
#include <functional>

namespace zetheta {
namespace risk {

// ============ Configuration Constants ============

constexpr size_t MAX_SYMBOLS = 128;
constexpr size_t SYMBOL_HASH_SIZE = 256;  // Must be power of 2
constexpr int64_t FIXED_POINT_SCALE = 10000;  // 4 decimal places

// ============ Fixed-Point Price Type ============

struct FixedPrice {
    int64_t value;  // Scaled by FIXED_POINT_SCALE
    
    constexpr FixedPrice() : value(0) {}
    constexpr explicit FixedPrice(int64_t v) : value(v) {}
    constexpr FixedPrice(double d) : value(static_cast<int64_t>(d * FIXED_POINT_SCALE)) {}
    
    constexpr double to_double() const { return static_cast<double>(value) / FIXED_POINT_SCALE; }
    constexpr int64_t scaled() const { return value; }
    
    constexpr FixedPrice operator+(FixedPrice other) const { return FixedPrice(value + other.value); }
    constexpr FixedPrice operator-(FixedPrice other) const { return FixedPrice(value - other.value); }
    constexpr FixedPrice operator*(int64_t scalar) const { return FixedPrice(value * scalar); }
    constexpr bool operator<(FixedPrice other) const { return value < other.value; }
    constexpr bool operator>(FixedPrice other) const { return value > other.value; }
    constexpr bool operator<=(FixedPrice other) const { return value <= other.value; }
    constexpr bool operator>=(FixedPrice other) const { return value >= other.value; }
};

// ============ Violation Types ============

enum class ViolationType : uint8_t {
    NONE = 0,
    POSITION_LIMIT = 1,
    PORTFOLIO_EXPOSURE = 2,
    DAILY_LOSS_LIMIT = 3,
    ROLLING_DRAWDOWN = 4,
    ORDER_RATE_EXCEEDED = 5,
    MAX_ORDER_SIZE = 6,
    CIRCUIT_BREAKER_OPEN = 7
};

constexpr const char* violation_to_string(ViolationType v) {
    switch (v) {
        case ViolationType::NONE: return "none";
        case ViolationType::POSITION_LIMIT: return "position_limit";
        case ViolationType::PORTFOLIO_EXPOSURE: return "portfolio_exposure";
        case ViolationType::DAILY_LOSS_LIMIT: return "daily_loss_limit";
        case ViolationType::ROLLING_DRAWDOWN: return "rolling_drawdown";
        case ViolationType::ORDER_RATE_EXCEEDED: return "order_rate_exceeded";
        case ViolationType::MAX_ORDER_SIZE: return "max_order_size";
        case ViolationType::CIRCUIT_BREAKER_OPEN: return "circuit_breaker_open";
        default: return "unknown";
    }
}

// ============ Circuit Breaker States ============

enum class CircuitState : uint8_t {
    CLOSED = 0,     // Normal operation
    OPEN = 1,       // Halted
    HALF_OPEN = 2   // Testing
};

// ============ Risk Check Result ============

struct alignas(64) RiskCheckResult {
    bool passed;
    ViolationType violation;
    int64_t violation_value;
    int64_t limit_value;
    uint64_t latency_ns;
    
    constexpr RiskCheckResult()
        : passed(true), violation(ViolationType::NONE),
          violation_value(0), limit_value(0), latency_ns(0) {}
    
    constexpr RiskCheckResult(bool p, ViolationType v, int64_t vv, int64_t lv)
        : passed(p), violation(v), violation_value(vv), limit_value(lv), latency_ns(0) {}
};

// ============ Risk Limits Configuration ============

struct RiskLimits {
    // Position limits
    int64_t max_position_per_symbol = 10000;
    int64_t max_portfolio_exposure = 1000000 * FIXED_POINT_SCALE;
    int64_t max_order_size = 1000;
    
    // Drawdown limits
    int64_t daily_loss_limit = 50000 * FIXED_POINT_SCALE;
    int32_t rolling_drawdown_bps = 1000;  // 10% = 1000 bps
    
    // Rate limits
    uint32_t max_orders_per_second = 100;
    uint32_t max_orders_per_minute = 2000;
    uint32_t burst_allowance = 50;
    
    // Circuit breaker
    uint32_t circuit_breaker_threshold = 3;
    uint32_t recovery_threshold = 5;
    uint64_t half_open_timeout_ns = 30'000'000'000ULL;  // 30 seconds
};

// ============ Token Bucket Rate Limiter ============

class alignas(64) TokenBucket {
public:
    TokenBucket(uint32_t rate, uint32_t burst)
        : rate_(rate), burst_(burst), tokens_(burst) {
        last_update_ = std::chrono::steady_clock::now();
    }
    
    bool try_acquire() {
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(
            now - last_update_).count();
        
        // Refill tokens based on time elapsed
        double new_tokens = static_cast<double>(elapsed) / 1e9 * rate_;
        tokens_ = std::min(static_cast<double>(burst_), tokens_ + new_tokens);
        last_update_ = now;
        
        if (tokens_ >= 1.0) {
            tokens_ -= 1.0;
            return true;
        }
        return false;
    }
    
    double available_tokens() const { return tokens_; }
    
    void reset() {
        tokens_ = burst_;
        last_update_ = std::chrono::steady_clock::now();
    }

private:
    uint32_t rate_;
    uint32_t burst_;
    double tokens_;
    std::chrono::steady_clock::time_point last_update_;
};

// ============ Symbol Hash for O(1) Lookup ============

constexpr uint32_t symbol_hash(std::string_view symbol) {
    uint32_t hash = 0;
    for (char c : symbol) {
        hash = hash * 31 + static_cast<uint32_t>(c);
    }
    return hash & (SYMBOL_HASH_SIZE - 1);
}

// ============ Position Entry ============

struct alignas(64) PositionEntry {
    std::atomic<int64_t> quantity{0};
    std::atomic<int64_t> price_scaled{0};  // Current price in fixed-point
    char symbol[16] = {0};
    bool active = false;
};

// ============ Circuit Breaker ============

class CircuitBreaker {
public:
    CircuitBreaker(const RiskLimits& limits)
        : limits_(limits), state_(CircuitState::CLOSED),
          failure_count_(0), success_count_(0), opened_at_(0) {}
    
    bool allow_request() {
        CircuitState current = state_.load(std::memory_order_acquire);
        
        if (current == CircuitState::CLOSED) {
            return true;
        }
        
        if (current == CircuitState::OPEN) {
            auto now = std::chrono::steady_clock::now().time_since_epoch().count();
            if (now - opened_at_.load() >= limits_.half_open_timeout_ns) {
                state_.store(CircuitState::HALF_OPEN, std::memory_order_release);
                success_count_.store(0, std::memory_order_release);
                return true;
            }
            return false;
        }
        
        // HALF_OPEN - allow testing
        return true;
    }
    
    void record_success() {
        CircuitState current = state_.load(std::memory_order_acquire);
        
        if (current == CircuitState::HALF_OPEN) {
            if (++success_count_ >= limits_.recovery_threshold) {
                state_.store(CircuitState::CLOSED, std::memory_order_release);
                failure_count_.store(0, std::memory_order_release);
            }
        } else if (current == CircuitState::CLOSED) {
            // Decay failures on success
            int32_t failures = failure_count_.load();
            if (failures > 0) {
                failure_count_.compare_exchange_weak(failures, failures - 1);
            }
        }
    }
    
    void record_failure() {
        CircuitState current = state_.load(std::memory_order_acquire);
        
        if (current == CircuitState::HALF_OPEN) {
            // Immediate trip back to open
            state_.store(CircuitState::OPEN, std::memory_order_release);
            opened_at_.store(std::chrono::steady_clock::now().time_since_epoch().count());
        } else if (current == CircuitState::CLOSED) {
            if (++failure_count_ >= limits_.circuit_breaker_threshold) {
                state_.store(CircuitState::OPEN, std::memory_order_release);
                opened_at_.store(std::chrono::steady_clock::now().time_since_epoch().count());
            }
        }
    }
    
    void force_open() {
        state_.store(CircuitState::OPEN, std::memory_order_release);
        opened_at_.store(std::chrono::steady_clock::now().time_since_epoch().count());
    }
    
    void force_close() {
        state_.store(CircuitState::CLOSED, std::memory_order_release);
        failure_count_.store(0, std::memory_order_release);
        success_count_.store(0, std::memory_order_release);
    }
    
    CircuitState get_state() const {
        return state_.load(std::memory_order_acquire);
    }

private:
    const RiskLimits& limits_;
    std::atomic<CircuitState> state_;
    std::atomic<int32_t> failure_count_;
    std::atomic<int32_t> success_count_;
    std::atomic<uint64_t> opened_at_;
};

// ============ Main Risk Engine ============

class RiskEngine {
public:
    explicit RiskEngine(RiskLimits limits = RiskLimits{})
        : limits_(limits),
          rate_limiter_1s_(limits.max_orders_per_second, limits.burst_allowance),
          rate_limiter_1m_(limits.max_orders_per_minute / 60, limits.max_orders_per_minute),
          circuit_breaker_(limits),
          daily_pnl_(0),
          peak_pnl_(0) {}
    
    /**
     * Perform pre-trade risk check.
     * Designed for sub-microsecond latency.
     * 
     * @param symbol Trading symbol
     * @param is_buy True for buy, false for sell
     * @param quantity Order quantity
     * @param price Order price (fixed-point)
     * @return RiskCheckResult with pass/fail and violation details
     */
    RiskCheckResult check_pre_trade(
        std::string_view symbol,
        bool is_buy,
        int64_t quantity,
        FixedPrice price
    ) {
        auto start = std::chrono::high_resolution_clock::now();
        
        // 1. Circuit breaker check (fastest exit)
        if (!circuit_breaker_.allow_request()) {
            return make_result(false, ViolationType::CIRCUIT_BREAKER_OPEN, 0, 0, start);
        }
        
        // 2. Rate limit check
        if (!rate_limiter_1s_.try_acquire()) {
            circuit_breaker_.record_failure();
            return make_result(false, ViolationType::ORDER_RATE_EXCEEDED,
                             limits_.max_orders_per_second, limits_.max_orders_per_second, start);
        }
        
        // 3. Order size check
        if (quantity > limits_.max_order_size) {
            circuit_breaker_.record_failure();
            return make_result(false, ViolationType::MAX_ORDER_SIZE,
                             quantity, limits_.max_order_size, start);
        }
        
        // 4. Position limit check
        uint32_t idx = symbol_hash(symbol);
        int64_t current_pos = positions_[idx].quantity.load(std::memory_order_acquire);
        int64_t delta = is_buy ? quantity : -quantity;
        int64_t new_pos = current_pos + delta;
        
        if (std::abs(new_pos) > limits_.max_position_per_symbol) {
            circuit_breaker_.record_failure();
            return make_result(false, ViolationType::POSITION_LIMIT,
                             new_pos, limits_.max_position_per_symbol, start);
        }
        
        // 5. Portfolio exposure check
        int64_t exposure = calculate_exposure();
        int64_t order_exposure = quantity * price.scaled();
        
        if (exposure + order_exposure > limits_.max_portfolio_exposure) {
            circuit_breaker_.record_failure();
            return make_result(false, ViolationType::PORTFOLIO_EXPOSURE,
                             (exposure + order_exposure) / FIXED_POINT_SCALE,
                             limits_.max_portfolio_exposure / FIXED_POINT_SCALE, start);
        }
        
        // 6. Drawdown check
        int64_t daily = daily_pnl_.load(std::memory_order_acquire);
        if (daily < -limits_.daily_loss_limit) {
            circuit_breaker_.record_failure();
            return make_result(false, ViolationType::DAILY_LOSS_LIMIT,
                             -daily / FIXED_POINT_SCALE,
                             limits_.daily_loss_limit / FIXED_POINT_SCALE, start);
        }
        
        // All checks passed
        circuit_breaker_.record_success();
        orders_checked_.fetch_add(1, std::memory_order_relaxed);
        
        return make_result(true, ViolationType::NONE, 0, 0, start);
    }
    
    /**
     * Update position for a symbol after trade execution.
     * Lock-free atomic update.
     */
    void update_position(std::string_view symbol, int64_t quantity) {
        uint32_t idx = symbol_hash(symbol);
        positions_[idx].quantity.store(quantity, std::memory_order_release);
        
        // Copy symbol if not set
        if (!positions_[idx].active) {
            size_t len = std::min(symbol.size(), sizeof(positions_[idx].symbol) - 1);
            std::copy(symbol.begin(), symbol.begin() + len, positions_[idx].symbol);
            positions_[idx].symbol[len] = '\0';
            positions_[idx].active = true;
        }
    }
    
    /**
     * Update price for a symbol.
     */
    void update_price(std::string_view symbol, FixedPrice price) {
        uint32_t idx = symbol_hash(symbol);
        positions_[idx].price_scaled.store(price.scaled(), std::memory_order_release);
    }
    
    /**
     * Update daily PnL.
     */
    void update_pnl(FixedPrice pnl) {
        daily_pnl_.store(pnl.scaled(), std::memory_order_release);
        
        // Update peak
        int64_t current_peak = peak_pnl_.load(std::memory_order_acquire);
        while (pnl.scaled() > current_peak) {
            if (peak_pnl_.compare_exchange_weak(current_peak, pnl.scaled())) {
                break;
            }
        }
    }
    
    /**
     * Get current position for a symbol.
     */
    int64_t get_position(std::string_view symbol) const {
        uint32_t idx = symbol_hash(symbol);
        return positions_[idx].quantity.load(std::memory_order_acquire);
    }
    
    /**
     * Calculate total portfolio exposure.
     */
    int64_t calculate_exposure() const {
        int64_t total = 0;
        for (const auto& pos : positions_) {
            if (pos.active) {
                int64_t qty = pos.quantity.load(std::memory_order_acquire);
                int64_t price = pos.price_scaled.load(std::memory_order_acquire);
                total += std::abs(qty) * price / FIXED_POINT_SCALE;
            }
        }
        return total;
    }
    
    /**
     * Get statistics.
     */
    uint64_t orders_checked() const {
        return orders_checked_.load(std::memory_order_acquire);
    }
    
    uint64_t orders_rejected() const {
        return orders_rejected_.load(std::memory_order_acquire);
    }
    
    CircuitState circuit_state() const {
        return circuit_breaker_.get_state();
    }
    
    /**
     * Reset all state for new session.
     */
    void reset() {
        for (auto& pos : positions_) {
            pos.quantity.store(0, std::memory_order_release);
            pos.price_scaled.store(0, std::memory_order_release);
            pos.active = false;
        }
        daily_pnl_.store(0, std::memory_order_release);
        peak_pnl_.store(0, std::memory_order_release);
        orders_checked_.store(0, std::memory_order_release);
        orders_rejected_.store(0, std::memory_order_release);
        rate_limiter_1s_.reset();
        rate_limiter_1m_.reset();
        circuit_breaker_.force_close();
    }
    
    /**
     * Force circuit breaker open (emergency stop).
     */
    void emergency_stop() {
        circuit_breaker_.force_open();
    }
    
    /**
     * Resume trading after emergency stop.
     */
    void resume_trading() {
        circuit_breaker_.force_close();
    }
    
    // Access limits for configuration
    RiskLimits& limits() { return limits_; }
    const RiskLimits& limits() const { return limits_; }

private:
    RiskCheckResult make_result(
        bool passed,
        ViolationType violation,
        int64_t violation_value,
        int64_t limit_value,
        std::chrono::high_resolution_clock::time_point start
    ) {
        RiskCheckResult result(passed, violation, violation_value, limit_value);
        auto end = std::chrono::high_resolution_clock::now();
        result.latency_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
        
        if (!passed) {
            orders_rejected_.fetch_add(1, std::memory_order_relaxed);
        }
        
        return result;
    }
    
    RiskLimits limits_;
    std::array<PositionEntry, SYMBOL_HASH_SIZE> positions_;
    TokenBucket rate_limiter_1s_;
    TokenBucket rate_limiter_1m_;
    CircuitBreaker circuit_breaker_;
    
    alignas(64) std::atomic<int64_t> daily_pnl_;
    alignas(64) std::atomic<int64_t> peak_pnl_;
    alignas(64) std::atomic<uint64_t> orders_checked_{0};
    alignas(64) std::atomic<uint64_t> orders_rejected_{0};
};

// ============ Challenge Presets ============

inline RiskLimits market_maker_limits() {
    RiskLimits limits;
    limits.max_position_per_symbol = 5000;
    limits.max_portfolio_exposure = 500000 * FIXED_POINT_SCALE;
    limits.max_order_size = 500;
    limits.daily_loss_limit = 25000 * FIXED_POINT_SCALE;
    limits.max_orders_per_second = 200;
    limits.max_orders_per_minute = 5000;
    limits.burst_allowance = 100;
    return limits;
}

inline RiskLimits latency_arb_limits() {
    RiskLimits limits;
    limits.max_position_per_symbol = 2000;
    limits.max_portfolio_exposure = 200000 * FIXED_POINT_SCALE;
    limits.max_order_size = 200;
    limits.daily_loss_limit = 10000 * FIXED_POINT_SCALE;
    limits.max_orders_per_second = 500;
    limits.max_orders_per_minute = 10000;
    limits.burst_allowance = 200;
    return limits;
}

inline RiskLimits momentum_limits() {
    RiskLimits limits;
    limits.max_position_per_symbol = 10000;
    limits.max_portfolio_exposure = 1000000 * FIXED_POINT_SCALE;
    limits.max_order_size = 1000;
    limits.daily_loss_limit = 50000 * FIXED_POINT_SCALE;
    limits.max_orders_per_second = 50;
    limits.max_orders_per_minute = 1000;
    limits.burst_allowance = 20;
    return limits;
}

inline RiskLimits flash_crash_limits() {
    RiskLimits limits;
    limits.max_position_per_symbol = 3000;
    limits.max_portfolio_exposure = 300000 * FIXED_POINT_SCALE;
    limits.max_order_size = 300;
    limits.daily_loss_limit = 15000 * FIXED_POINT_SCALE;
    limits.rolling_drawdown_bps = 2000;  // 20% tolerance
    limits.max_orders_per_second = 150;
    limits.max_orders_per_minute = 3000;
    limits.burst_allowance = 50;
    return limits;
}

}  // namespace risk
}  // namespace zetheta
