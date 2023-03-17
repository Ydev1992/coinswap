import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { v2Fixture } from './shared/fixtures'
import { expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('CoinSwapMigrator', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let WBNBPartner: Contract
  let WBNBPair: Contract
  let router: Contract
  let migrator: Contract
  let WBNBExchangeV1: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)
    WBNBPartner = fixture.WBNBPartner
    WBNBPair = fixture.WBNBPair
    router = fixture.router01 // we used router01 for this contract
    migrator = fixture.migrator
    WBNBExchangeV1 = fixture.WBNBExchangeV1
  })

  it('migrate', async () => {
    const WBNBPartnerAmount = expandTo18Decimals(1)
    const BNBAmount = expandTo18Decimals(4)
    await WBNBPartner.approve(WBNBExchangeV1.address, MaxUint256)
    await WBNBExchangeV1.addLiquidity(bigNumberify(1), WBNBPartnerAmount, MaxUint256, {
      ...overrides,
      value: BNBAmount
    })
    await WBNBExchangeV1.approve(migrator.address, MaxUint256)
    const expectedLiquidity = expandTo18Decimals(2)
    const WBNBPairToken0 = await WBNBPair.token0()
    await expect(
      migrator.migrate(WBNBPartner.address, WBNBPartnerAmount, BNBAmount, wallet.address, MaxUint256, overrides)
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
})
