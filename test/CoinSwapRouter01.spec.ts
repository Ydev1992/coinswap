import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, Zero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { expandTo18Decimals, getApprovalDigest, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

enum RouterVersion {
  CoinSwapRouter01 = 'CoinSwapRouter01',
  CoinSwapRouter02 = 'CoinSwapRouter02'
}

describe('CoinSwapRouter{01,02}', () => {
  for (const routerVersion of Object.keys(RouterVersion)) {
    const provider = new MockProvider({
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999
    })
    const [wallet] = provider.getWallets()
    const loadFixture = createFixtureLoader(provider, [wallet])

    let token0: Contract
    let token1: Contract
    let WBNB: Contract
    let WBNBPartner: Contract
    let factory: Contract
    let router: Contract
    let pair: Contract
    let WBNBPair: Contract
    let routerEventEmitter: Contract
    beforeEach(async function() {
      const fixture = await loadFixture(v2Fixture)
      token0 = fixture.token0
      token1 = fixture.token1
      WBNB = fixture.WBNB
      WBNBPartner = fixture.WBNBPartner
      factory = fixture.factoryV2
      router = {
        [RouterVersion.CoinSwapRouter01]: fixture.router01,
        [RouterVersion.CoinSwapRouter02]: fixture.router02
      }[routerVersion as RouterVersion]
      pair = fixture.pair
      WBNBPair = fixture.WBNBPair
      routerEventEmitter = fixture.routerEventEmitter
    })

    afterEach(async function() {
      expect(await provider.getBalance(router.address)).to.eq(Zero)
    })

    describe(routerVersion, () => {
      it('factory, WBNB', async () => {
        expect(await router.factory()).to.eq(factory.address)
        expect(await router.WBNB()).to.eq(WBNB.address)
      })

      it('addLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        await token0.approve(router.address, MaxUint256)
        await token1.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidity(
            token0.address,
            token1.address,
            token0Amount,
            token1Amount,
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, 'Transfer')
          .withArgs(wallet.address, pair.address, token0Amount)
          .to.emit(token1, 'Transfer')
          .withArgs(wallet.address, pair.address, token1Amount)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Sync')
          .withArgs(token0Amount, token1Amount)
          .to.emit(pair, 'Mint')
          .withArgs(router.address, token0Amount, token1Amount)

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      })

      it('addLiquidityBNB', async () => {
        const WBNBPartnerAmount = expandTo18Decimals(1)
        const BNBAmount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        const WBNBPairToken0 = await WBNBPair.token0()
        await WBNBPartner.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidityBNB(
            WBNBPartner.address,
            WBNBPartnerAmount,
            WBNBPartnerAmount,
            BNBAmount,
            wallet.address,
            MaxUint256,
            { ...overrides, value: BNBAmount }
          )
        )
          .to.emit(WBNBPair, 'Transfer')
          .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
          .to.emit(WBNBPair, 'Transfer')
          .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WBNBPair, 'Sync')
          .withArgs(
            WBNBPairToken0 === WBNBPartner.address ? WBNBPartnerAmount : BNBAmount,
            WBNBPairToken0 === WBNBPartner.address ? BNBAmount : WBNBPartnerAmount
          )
          .to.emit(WBNBPair, 'Mint')
          .withArgs(
            router.address,
            WBNBPairToken0 === WBNBPartner.address ? WBNBPartnerAmount : BNBAmount,
            WBNBPairToken0 === WBNBPartner.address ? BNBAmount : WBNBPartnerAmount
          )

        expect(await WBNBPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      })

      async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)
        await pair.mint(wallet.address, overrides)
      }
      it('removeLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)
        await pair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidity(
            token0.address,
            token1.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(pair, 'Transfer')
          .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Transfer')
          .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(token0, 'Transfer')
          .withArgs(pair.address, wallet.address, token0Amount.sub(500))
          .to.emit(token1, 'Transfer')
          .withArgs(pair.address, wallet.address, token1Amount.sub(2000))
          .to.emit(pair, 'Sync')
          .withArgs(500, 2000)
          .to.emit(pair, 'Burn')
          .withArgs(router.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address)

        expect(await pair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(500))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(2000))
      })

      it('removeLiquidityBNB', async () => {
        const WBNBPartnerAmount = expandTo18Decimals(1)
        const BNBAmount = expandTo18Decimals(4)
        await WBNBPartner.transfer(WBNBPair.address, WBNBPartnerAmount)
        await WBNB.deposit({ value: BNBAmount })
        await WBNB.transfer(WBNBPair.address, BNBAmount)
        await WBNBPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)
        const WBNBPairToken0 = await WBNBPair.token0()
        await WBNBPair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidityBNB(
            WBNBPartner.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(WBNBPair, 'Transfer')
          .withArgs(wallet.address, WBNBPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WBNBPair, 'Transfer')
          .withArgs(WBNBPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WBNB, 'Transfer')
          .withArgs(WBNBPair.address, router.address, BNBAmount.sub(2000))
          .to.emit(WBNBPartner, 'Transfer')
          .withArgs(WBNBPair.address, router.address, WBNBPartnerAmount.sub(500))
          .to.emit(WBNBPartner, 'Transfer')
          .withArgs(router.address, wallet.address, WBNBPartnerAmount.sub(500))
          .to.emit(WBNBPair, 'Sync')
          .withArgs(
            WBNBPairToken0 === WBNBPartner.address ? 500 : 2000,
            WBNBPairToken0 === WBNBPartner.address ? 2000 : 500
          )
          .to.emit(WBNBPair, 'Burn')
          .withArgs(
            router.address,
            WBNBPairToken0 === WBNBPartner.address ? WBNBPartnerAmount.sub(500) : BNBAmount.sub(2000),
            WBNBPairToken0 === WBNBPartner.address ? BNBAmount.sub(2000) : WBNBPartnerAmount.sub(500),
            router.address
          )

        expect(await WBNBPair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyWBNBPartner = await WBNBPartner.totalSupply()
        const totalSupplyWBNB = await WBNB.totalSupply()
        expect(await WBNBPartner.balanceOf(wallet.address)).to.eq(totalSupplyWBNBPartner.sub(500))
        expect(await WBNB.balanceOf(wallet.address)).to.eq(totalSupplyWBNB.sub(2000))
      })

      it('removeLiquidityWithPermit', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await pair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          pair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityWithPermit(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      it('removeLiquidityBNBWithPermit', async () => {
        const WBNBPartnerAmount = expandTo18Decimals(1)
        const BNBAmount = expandTo18Decimals(4)
        await WBNBPartner.transfer(WBNBPair.address, WBNBPartnerAmount)
        await WBNB.deposit({ value: BNBAmount })
        await WBNB.transfer(WBNBPair.address, BNBAmount)
        await WBNBPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await WBNBPair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          WBNBPair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityBNBWithPermit(
          WBNBPartner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      describe('swapExactTokensForTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          await expect(
            router.swapExactTokensForTokens(
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, swapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForTokens(
              router.address,
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          await token0.approve(router.address, MaxUint256)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactTokensForTokens(
            swapAmount,
            0,
            [token0.address, token1.address],
            wallet.address,
            MaxUint256,
            overrides
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.CoinSwapRouter01]: 101876,
              [RouterVersion.CoinSwapRouter02]: 101898
            }[routerVersion as RouterVersion]
          )
        }).retries(3)
      })

      describe('swapTokensForExactTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
        })

        it('happy path', async () => {
          await token0.approve(router.address, MaxUint256)
          await expect(
            router.swapTokensForExactTokens(
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedSwapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, outputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactTokens(
              router.address,
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactBNBForTokens', () => {
        const WBNBPartnerAmount = expandTo18Decimals(10)
        const BNBAmount = expandTo18Decimals(5)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WBNBPartner.transfer(WBNBPair.address, WBNBPartnerAmount)
          await WBNB.deposit({ value: BNBAmount })
          await WBNB.transfer(WBNBPair.address, BNBAmount)
          await WBNBPair.mint(wallet.address, overrides)

          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          const WBNBPairToken0 = await WBNBPair.token0()
          await expect(
            router.swapExactBNBForTokens(0, [WBNB.address, WBNBPartner.address], wallet.address, MaxUint256, {
              ...overrides,
              value: swapAmount
            })
          )
            .to.emit(WBNB, 'Transfer')
            .withArgs(router.address, WBNBPair.address, swapAmount)
            .to.emit(WBNBPartner, 'Transfer')
            .withArgs(WBNBPair.address, wallet.address, expectedOutputAmount)
            .to.emit(WBNBPair, 'Sync')
            .withArgs(
              WBNBPairToken0 === WBNBPartner.address
                ? WBNBPartnerAmount.sub(expectedOutputAmount)
                : BNBAmount.add(swapAmount),
              WBNBPairToken0 === WBNBPartner.address
                ? BNBAmount.add(swapAmount)
                : WBNBPartnerAmount.sub(expectedOutputAmount)
            )
            .to.emit(WBNBPair, 'Swap')
            .withArgs(
              router.address,
              WBNBPairToken0 === WBNBPartner.address ? 0 : swapAmount,
              WBNBPairToken0 === WBNBPartner.address ? swapAmount : 0,
              WBNBPairToken0 === WBNBPartner.address ? expectedOutputAmount : 0,
              WBNBPairToken0 === WBNBPartner.address ? 0 : expectedOutputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapExactBNBForTokens(
              router.address,
              0,
              [WBNB.address, WBNBPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: swapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          const WBNBPartnerAmount = expandTo18Decimals(10)
          const BNBAmount = expandTo18Decimals(5)
          await WBNBPartner.transfer(WBNBPair.address, WBNBPartnerAmount)
          await WBNB.deposit({ value: BNBAmount })
          await WBNB.transfer(WBNBPair.address, BNBAmount)
          await WBNBPair.mint(wallet.address, overrides)

          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          const swapAmount = expandTo18Decimals(1)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactBNBForTokens(
            0,
            [WBNB.address, WBNBPartner.address],
            wallet.address,
            MaxUint256,
            {
              ...overrides,
              value: swapAmount
            }
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.CoinSwapRouter01]: 138770,
              [RouterVersion.CoinSwapRouter02]: 138770
            }[routerVersion as RouterVersion]
          )
        }).retries(3)
      })

      describe('swapTokensForExactBNB', () => {
        const WBNBPartnerAmount = expandTo18Decimals(5)
        const BNBAmount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WBNBPartner.transfer(WBNBPair.address, WBNBPartnerAmount)
          await WBNB.deposit({ value: BNBAmount })
          await WBNB.transfer(WBNBPair.address, BNBAmount)
          await WBNBPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WBNBPartner.approve(router.address, MaxUint256)
          const WBNBPairToken0 = await WBNBPair.token0()
          await expect(
            router.swapTokensForExactBNB(
              outputAmount,
              MaxUint256,
              [WBNBPartner.address, WBNB.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WBNBPartner, 'Transfer')
            .withArgs(wallet.address, WBNBPair.address, expectedSwapAmount)
            .to.emit(WBNB, 'Transfer')
            .withArgs(WBNBPair.address, router.address, outputAmount)
            .to.emit(WBNBPair, 'Sync')
            .withArgs(
              WBNBPairToken0 === WBNBPartner.address
                ? WBNBPartnerAmount.add(expectedSwapAmount)
                : BNBAmount.sub(outputAmount),
              WBNBPairToken0 === WBNBPartner.address
                ? BNBAmount.sub(outputAmount)
                : WBNBPartnerAmount.add(expectedSwapAmount)
            )
            .to.emit(WBNBPair, 'Swap')
            .withArgs(
              router.address,
              WBNBPairToken0 === WBNBPartner.address ? expectedSwapAmount : 0,
              WBNBPairToken0 === WBNBPartner.address ? 0 : expectedSwapAmount,
              WBNBPairToken0 === WBNBPartner.address ? 0 : outputAmount,
              WBNBPairToken0 === WBNBPartner.address ? outputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WBNBPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactBNB(
              router.address,
              outputAmount,
              MaxUint256,
              [WBNBPartner.address, WBNB.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactTokensForBNB', () => {
        const WBNBPartnerAmount = expandTo18Decimals(5)
        const BNBAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WBNBPartner.transfer(WBNBPair.address, WBNBPartnerAmount)
          await WBNB.deposit({ value: BNBAmount })
          await WBNB.transfer(WBNBPair.address, BNBAmount)
          await WBNBPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WBNBPartner.approve(router.address, MaxUint256)
          const WBNBPairToken0 = await WBNBPair.token0()
          await expect(
            router.swapExactTokensForBNB(
              swapAmount,
              0,
              [WBNBPartner.address, WBNB.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WBNBPartner, 'Transfer')
            .withArgs(wallet.address, WBNBPair.address, swapAmount)
            .to.emit(WBNB, 'Transfer')
            .withArgs(WBNBPair.address, router.address, expectedOutputAmount)
            .to.emit(WBNBPair, 'Sync')
            .withArgs(
              WBNBPairToken0 === WBNBPartner.address
                ? WBNBPartnerAmount.add(swapAmount)
                : BNBAmount.sub(expectedOutputAmount),
              WBNBPairToken0 === WBNBPartner.address
                ? BNBAmount.sub(expectedOutputAmount)
                : WBNBPartnerAmount.add(swapAmount)
            )
            .to.emit(WBNBPair, 'Swap')
            .withArgs(
              router.address,
              WBNBPairToken0 === WBNBPartner.address ? swapAmount : 0,
              WBNBPairToken0 === WBNBPartner.address ? 0 : swapAmount,
              WBNBPairToken0 === WBNBPartner.address ? 0 : expectedOutputAmount,
              WBNBPairToken0 === WBNBPartner.address ? expectedOutputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WBNBPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForBNB(
              router.address,
              swapAmount,
              0,
              [WBNBPartner.address, WBNB.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })
      })

      describe('swapBNBForExactTokens', () => {
        const WBNBPartnerAmount = expandTo18Decimals(10)
        const BNBAmount = expandTo18Decimals(5)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WBNBPartner.transfer(WBNBPair.address, WBNBPartnerAmount)
          await WBNB.deposit({ value: BNBAmount })
          await WBNB.transfer(WBNBPair.address, BNBAmount)
          await WBNBPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          const WBNBPairToken0 = await WBNBPair.token0()
          await expect(
            router.swapBNBForExactTokens(
              outputAmount,
              [WBNB.address, WBNBPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(WBNB, 'Transfer')
            .withArgs(router.address, WBNBPair.address, expectedSwapAmount)
            .to.emit(WBNBPartner, 'Transfer')
            .withArgs(WBNBPair.address, wallet.address, outputAmount)
            .to.emit(WBNBPair, 'Sync')
            .withArgs(
              WBNBPairToken0 === WBNBPartner.address
                ? WBNBPartnerAmount.sub(outputAmount)
                : BNBAmount.add(expectedSwapAmount),
              WBNBPairToken0 === WBNBPartner.address
                ? BNBAmount.add(expectedSwapAmount)
                : WBNBPartnerAmount.sub(outputAmount)
            )
            .to.emit(WBNBPair, 'Swap')
            .withArgs(
              router.address,
              WBNBPairToken0 === WBNBPartner.address ? 0 : expectedSwapAmount,
              WBNBPairToken0 === WBNBPartner.address ? expectedSwapAmount : 0,
              WBNBPairToken0 === WBNBPartner.address ? outputAmount : 0,
              WBNBPairToken0 === WBNBPartner.address ? 0 : outputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapBNBForExactTokens(
              router.address,
              outputAmount,
              [WBNB.address, WBNBPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })
    })
  }
})
