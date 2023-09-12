// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../implementation/PriceOracle.sol";
import "../../userInterfaces/IERC20PriceOracle.sol";
import "../../userInterfaces/IPriceOracle.sol";

// import "hardhat/console.sol";

contract ERC20PriceOracle is IERC20PriceOracle, Governed {
    IPriceOracle priceOracle;

    mapping(address => bytes8)
        public currencyAddressToSymbol;

    constructor(address _governance) Governed(_governance) {}

    function setPriceOracle(IPriceOracle _priceOracle) public onlyGovernance {
        require(address(_priceOracle) != address(0), "zero address set oracle");
        priceOracle = _priceOracle;
    }

    function setERC20Settings(
        address _erc20Address,
        bytes8 _symbol
    ) public onlyGovernance {
        require(_erc20Address != address(0), "zero address set settings");
        require(_symbol != bytes8(0), "symbol must be non-zero");
        currencyAddressToSymbol[_erc20Address] = _symbol;
    }

    function getPrice(
        address _currencyAddress
    ) public view returns (uint32 price, uint32 timestamp) {
        require(_currencyAddress != address(0), "zero address get price");
        bytes8 symbol = currencyAddressToSymbol[_currencyAddress];
        require(symbol != bytes8(0), "symbol not found");
        (price, timestamp) = priceOracle.lastAnchorPriceForSymbol(symbol);
    }
}
